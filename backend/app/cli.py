import asyncio
import click
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.core.security import hash_password
from app.users.models import Instructor, User, UserRole


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


@cli.command()
@click.option("--email", prompt="User Email", help="Email of the user whose password is to be reset")
@click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True, help="New Password")
def reset_password(email, password):
    """Reset the password for any existing user."""
    async def _reset():
        async with AsyncSessionLocal() as session:
            stmt = select(User).where(User.email == email.strip().lower())
            result = await session.execute(stmt)
            user = result.scalar_one_or_none()

            if not user:
                click.secho(f"Error: User with email {email} was not found.", fg="red")
                return

            user.password_hash = hash_password(password)
            await session.commit()
            click.secho(f"Successfully updated password for {email}", fg="green")

    asyncio.run(_reset())


@cli.command()
@click.option("--email", prompt="Instructor Email", help="Instructor's email address")
@click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True, help="Instructor Password")
@click.option("--name", prompt="Display Name", help="Public instructor name")
@click.option("--timezone", default="Asia/Kolkata", help="Timezone identifier (e.g. Asia/Kolkata, America/New_York)")
def create_instructor(email, password, name, timezone):
    """Create a new instructor user with linked instructor profile."""
    async def _create():
        async with AsyncSessionLocal() as session:
            stmt = select(User).where(User.email == email.strip().lower())
            result = await session.execute(stmt)
            if result.scalar_one_or_none():
                click.secho(f"Error: User with email {email} already exists.", fg="red")
                return

            user = User(
                email=email.strip().lower(),
                password_hash=hash_password(password),
                role=UserRole.INSTRUCTOR,
                full_name=name,
                is_active=True
            )
            session.add(user)
            await session.flush()

            instructor = Instructor(
                user_id=user.id,
                display_name=name,
                timezone=timezone,
                is_available_for_booking=True
            )
            session.add(instructor)
            await session.commit()
            click.secho(f"Successfully created instructor {name} ({email}) with timezone {timezone}", fg="green")

    asyncio.run(_create())


if __name__ == "__main__":
    cli()
