import argparse
import getpass
import os
import secrets

from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import Instructor, User
from app.db.session import SessionLocal


def create_admin(email: str) -> None:
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or getpass.getpass("Admin password (minimum 12 characters): ")
    if len(password) < 12:
        raise SystemExit("Password must be at least 12 characters")
    with SessionLocal() as db:
        normalized = email.strip().lower()
        if db.scalar(select(User.id).where(User.email == normalized)):
            raise SystemExit("A user with that email already exists")
        db.add(User(email=normalized, password_hash=hash_password(password), role="admin"))
        db.commit()
    print(f"Administrator account created for {email}")


def seed_demo(email: str, instructor_count: int) -> None:
    if get_settings().app_env not in {"development", "test"}:
        raise SystemExit("Demo seeding is allowed only when APP_ENV is development or test")
    if not 1 <= instructor_count <= 50:
        raise SystemExit("Instructor count must be between 1 and 50")
    admin_password = getpass.getpass("New administrator password (minimum 12 characters): ")
    if len(admin_password) < 12:
        raise SystemExit("Password must be at least 12 characters")
    admin_email = email.strip().lower()
    names = ["Avery Chen", "Jordan Patel", "Morgan Rivera", "Taylor Kim", "Riley Thompson",
             "Casey Singh", "Quinn Brooks", "Jamie Wilson", "Cameron Ali", "Drew Martin"]
    credentials: list[tuple[str, str]] = []
    with SessionLocal() as db:
        existing = db.scalars(select(User.email).where(
            (User.email == admin_email) | (User.email.like("coach%demo.example.test"))
        )).all()
        if existing:
            raise SystemExit("Admin or demo instructor accounts already exist; refusing to overwrite accounts")
        admin = User(email=admin_email, password_hash=hash_password(admin_password), role="admin")
        db.add(admin)
        for index in range(instructor_count):
            instructor_email = f"coach{index + 1:02d}@demo.example.test"
            password = secrets.token_urlsafe(18)
            account = User(email=instructor_email, password_hash=hash_password(password), role="instructor")
            db.add(account)
            db.flush()
            db.add(Instructor(user_id=account.id, display_name=names[index % len(names)], timezone="America/New_York"))
            credentials.append((instructor_email, password))
        db.commit()
    print(f"Administrator account created for {admin_email}")
    print("Temporary instructor credentials (save them now; passwords are not stored in plaintext):")
    for instructor_email, password in credentials:
        print(f"{instructor_email}\t{password}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    admin_parser = subparsers.add_parser("create-admin")
    admin_parser.add_argument("--email", required=True)
    seed_parser = subparsers.add_parser("seed-demo")
    seed_parser.add_argument("--admin-email", default="admin@example.test")
    seed_parser.add_argument("--instructors", type=int, default=10)
    args = parser.parse_args()
    if args.command == "create-admin":
        create_admin(args.email)
    elif args.command == "seed-demo":
        seed_demo(args.admin_email, args.instructors)
