import re
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.security import create_access_token, decode_access_token, hash_password, verify_password
from src.db.models import UserORM
from src.db.session import get_session

auth_router = APIRouter(prefix="/auth", tags=["auth"])
security_scheme = HTTPBearer(auto_error=False)

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


class RegisterRequest(BaseModel):
    email: str
    password: str
    role: str = "editor"

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v_clean = v.strip().lower()
        if not EMAIL_REGEX.match(v_clean):
            raise ValueError("Некорректный формат email. Пример: user@domain.com")
        return v_clean

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Пароль должен состоять минимум из 8 символов")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


class DemoLoginRequest(BaseModel):
    role: str = "editor"


async def get_current_user_optional(
    auth_credentials: HTTPAuthorizationCredentials | None = Depends(security_scheme),
    authorization: str | None = Header(None),
    session: AsyncSession = Depends(get_session),
) -> UserORM | None:
    token = None
    if auth_credentials:
        token = auth_credentials.credentials
    elif authorization:
        token = authorization[7:].strip() if authorization.startswith("Bearer ") else authorization.strip()

    if not token:
        return None

    payload = decode_access_token(token)
    if not payload:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    user = (await session.execute(select(UserORM).where(UserORM.id == user_id))).scalar_one_or_none()
    if user is None and payload.get("email", "").endswith("postcode.local"):
        # demo-пользователи автосеются в любую БД (tmp-test/демо), idempotentно
        role = payload.get("role", "editor")
        if role in ("admin", "editor", "reader"):
            user = UserORM(id=user_id, email=payload["email"], password_hash="", role=role)
            session.add(user)
            await session.commit()
    return user


async def get_current_user(
    user: UserORM | None = Depends(get_current_user_optional),
) -> UserORM:
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Необходима аутентификация",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


@auth_router.post("/register", status_code=201)
async def register(body: RegisterRequest, session: AsyncSession = Depends(get_session)) -> dict:
    existing = (await session.execute(select(UserORM).where(UserORM.email == body.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Пользователь с таким email уже существует")

    # Предотвращение самоназначения роли admin при открытой регистрации
    role = body.role.lower() if body.role.lower() in ("editor", "reader") else "editor"
    user = UserORM(
        email=body.email,
        password_hash=hash_password(body.password),
        role=role,
    )
    session.add(user)
    await session.commit()

    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email, "role": user.role},
    }


@auth_router.post("/login")
async def login(body: LoginRequest, session: AsyncSession = Depends(get_session)) -> dict:
    user = (await session.execute(select(UserORM).where(UserORM.email == body.email.lower()))).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email, "role": user.role},
    }


@auth_router.post("/demo-login")
async def demo_login(body: DemoLoginRequest | None = None, session: AsyncSession = Depends(get_session)) -> dict:
    req_role = body.role if body and body.role in ("admin", "editor", "reader") else "editor"
    demo_email = f"demo_{req_role}@postcode.local"

    user = (await session.execute(select(UserORM).where(UserORM.email == demo_email))).scalar_one_or_none()
    if not user:
        user = UserORM(
            email=demo_email,
            password_hash=hash_password("demo_password_123"),
            role=req_role,
        )
        session.add(user)
        await session.commit()

    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email, "role": user.role},
    }


@auth_router.get("/me")
async def get_me(user: UserORM = Depends(get_current_user)) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "created_at": str(user.created_at),
    }
