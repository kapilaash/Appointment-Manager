import asyncio
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings


def build_message(recipient: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = formataddr((settings.MAIL_FROM_NAME, settings.MAIL_FROM))
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    return message


def _send_message(message: EmailMessage) -> None:
    smtp_class = smtplib.SMTP_SSL if settings.SMTP_USE_SSL else smtplib.SMTP
    with smtp_class(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
        if settings.SMTP_USE_TLS and not settings.SMTP_USE_SSL:
            smtp.starttls()
            smtp.ehlo()
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(message)


async def send_message(message: EmailMessage) -> None:
    await asyncio.to_thread(_send_message, message)
