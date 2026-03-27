"""
Email service — sends verification and password reset emails.

In development: logs email content to console (no SMTP required).
In production: sends via SMTP (Gmail, SendGrid, etc.).

Security:
- Tokens are generated server-side, never exposed in logs
- Only the reset/verify URL is logged in dev mode
- SMTP credentials read from environment variables
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from core.settings import settings

logger = logging.getLogger(__name__)


def _build_reset_email_html(reset_url: str, user_name: str) -> str:
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background: #1B3A5C; color: white; font-weight: bold; padding: 12px 16px; border-radius: 12px; font-size: 14px;">TDS</div>
        </div>
        <h2 style="color: #1B3A5C; margin-bottom: 8px;">Reset Your Password</h2>
        <p style="color: #555; font-size: 14px;">Hi {user_name},</p>
        <p style="color: #555; font-size: 14px;">We received a request to reset your password for the 26AS Matcher platform. Click the button below to set a new password:</p>
        <div style="text-align: center; margin: 24px 0;">
            <a href="{reset_url}" style="background: #1B3A5C; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">Reset Password</a>
        </div>
        <p style="color: #888; font-size: 12px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 11px; text-align: center;">26AS Matcher &middot; TDS Reconciliation Platform</p>
    </div>
    """


def _build_verification_email_html(verify_url: str, user_name: str) -> str:
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background: #1B3A5C; color: white; font-weight: bold; padding: 12px 16px; border-radius: 12px; font-size: 14px;">TDS</div>
        </div>
        <h2 style="color: #1B3A5C; margin-bottom: 8px;">Verify Your Email</h2>
        <p style="color: #555; font-size: 14px;">Hi {user_name},</p>
        <p style="color: #555; font-size: 14px;">Welcome to 26AS Matcher! Please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 24px 0;">
            <a href="{verify_url}" style="background: #1B3A5C; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">Verify Email</a>
        </div>
        <p style="color: #888; font-size: 12px;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #aaa; font-size: 11px; text-align: center;">26AS Matcher &middot; TDS Reconciliation Platform</p>
    </div>
    """


def send_password_reset_email(
    to_email: str,
    user_name: str,
    reset_url: str,
) -> bool:
    """Send password reset email. Returns True on success."""
    subject = "Reset Your Password — 26AS Matcher"
    html = _build_reset_email_html(reset_url, user_name)
    return _send_email(to_email, subject, html)


def send_verification_email(
    to_email: str,
    user_name: str,
    verify_url: str,
) -> bool:
    """Send email verification link. Returns True on success."""
    subject = "Verify Your Email — 26AS Matcher"
    html = _build_verification_email_html(verify_url, user_name)
    return _send_email(to_email, subject, html)


def _send_email(to_email: str, subject: str, html_body: str) -> bool:
    """
    Send email via SMTP or log to console in dev mode.
    """
    # Dev mode: log to console instead of sending
    if settings.ENVIRONMENT == "development" or not settings.SMTP_HOST:
        logger.info(
            "=== EMAIL (dev mode — not sent) ===\n"
            "  To: %s\n"
            "  Subject: %s\n"
            "  [HTML body omitted — check email service logs]\n"
            "===================================",
            to_email, subject,
        )
        return True

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM_EMAIL
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            if settings.SMTP_TLS:
                server.starttls()
            if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM_EMAIL, to_email, msg.as_string())

        logger.info("Email sent successfully to %s", to_email)
        return True

    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, str(e))
        return False
