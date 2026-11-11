import asyncio
import click
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.core.security import hash_password
from app.db.base import Base, UUIDPrimaryKeyMixin, TimestampMixin
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean, Enum
import enum


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    INSTRUCTOR = "instructor"


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.INSTRUCTOR, nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


@click.group()
def cli():
    """Administrative CLI commands for Chess Academy Platform."""
    pass


@cli.command()
@click.option("--email", prompt="Admin Email", help="The administrator email address")
@click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True, help="Admin Password")
@click.option("--name", default="Super Admin", help="Full Name")
def seed_admin(email, password, name):
    """Seed or update the default administrator user safely."""
    async def _seed():
        async with AsyncSessionLocal() as session:
            stmt = select(User).where(User.email == email.strip().lower())
            result = await session.execute(stmt)
            user = result.scalar_one_or_none()

            if user:
                click.echo(f"User {email} exists. Updating password and ensuring admin role.")
                user.password_hash = hash_password(password)
                user.role = UserRole.ADMIN
                user.is_active = True
                user.full_name = name
            else:
                click.echo(f"Creating new Admin user: {email}")
                user = User(
                    email=email.strip().lower(),
                    password_hash=hash_password(password),
                    role=UserRole.ADMIN,
                    full_name=name,
                    is_active=True
                )
                session.add(user)

            await session.commit()
            click.secho(f"Successfully configured administrator {email}", fg="green")

    asyncio.run(_seed())


if __name__ == "__main__":
    cli()
