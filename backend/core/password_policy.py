"""
Password policy enforcement + strength scoring.

Security:
- Minimum 8 characters, max 128
- Must include: uppercase, lowercase, digit, special character
- Strength meter: 0–4 scale (Weak → Very Strong)
- Common password check against top-1000 list
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List

# Top common passwords (abbreviated — extend as needed)
COMMON_PASSWORDS = frozenset({
    "password", "12345678", "123456789", "1234567890", "qwerty123",
    "password1", "password123", "admin123", "letmein", "welcome",
    "monkey123", "dragon123", "master123", "abc12345", "trustno1",
    "iloveyou", "sunshine", "princess", "football", "charlie",
    "shadow123", "michael1", "jennifer", "1234abcd", "abcdefgh",
    "qwerty12", "passw0rd", "p@ssw0rd", "p@ssword", "admin1234",
    "welcome1", "changeme", "test1234", "pass1234", "hello123",
})

MIN_LENGTH = 8
MAX_LENGTH = 128

HAS_UPPER = re.compile(r"[A-Z]")
HAS_LOWER = re.compile(r"[a-z]")
HAS_DIGIT = re.compile(r"\d")
HAS_SPECIAL = re.compile(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?`~]")


@dataclass
class PasswordValidationResult:
    valid: bool
    errors: List[str]
    strength: int          # 0=Weak, 1=Fair, 2=Good, 3=Strong, 4=Very Strong
    strength_label: str    # Human-readable label


def validate_password(password: str) -> PasswordValidationResult:
    """
    Validate password against policy rules.
    Returns validation result with errors and strength score.
    """
    errors: List[str] = []

    if len(password) < MIN_LENGTH:
        errors.append(f"Must be at least {MIN_LENGTH} characters")
    if len(password) > MAX_LENGTH:
        errors.append(f"Must be at most {MAX_LENGTH} characters")
    if not HAS_UPPER.search(password):
        errors.append("Must include at least one uppercase letter")
    if not HAS_LOWER.search(password):
        errors.append("Must include at least one lowercase letter")
    if not HAS_DIGIT.search(password):
        errors.append("Must include at least one digit")
    if not HAS_SPECIAL.search(password):
        errors.append("Must include at least one special character (!@#$%^&*...)")
    if password.lower() in COMMON_PASSWORDS:
        errors.append("This password is too common")

    strength = compute_strength(password)
    labels = {0: "Weak", 1: "Fair", 2: "Good", 3: "Strong", 4: "Very Strong"}

    return PasswordValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        strength=strength,
        strength_label=labels.get(strength, "Weak"),
    )


def compute_strength(password: str) -> int:
    """
    Compute password strength on a 0–4 scale.
    Factors: length, character diversity, no common patterns.
    """
    score = 0

    # Length bonus
    if len(password) >= 8:
        score += 1
    if len(password) >= 12:
        score += 1

    # Character diversity
    diversity = 0
    if HAS_UPPER.search(password):
        diversity += 1
    if HAS_LOWER.search(password):
        diversity += 1
    if HAS_DIGIT.search(password):
        diversity += 1
    if HAS_SPECIAL.search(password):
        diversity += 1

    if diversity >= 3:
        score += 1
    if diversity >= 4:
        score += 1

    # Penalty for common passwords
    if password.lower() in COMMON_PASSWORDS:
        score = 0

    # Penalty for sequential/repeated chars
    if re.search(r"(.)\1{2,}", password):  # 3+ repeated chars
        score = max(0, score - 1)

    return min(4, score)
