import fitz
import io

import pytest

from app.pdf_generator import generate_resume_pdf, generate_cover_letter_pdf


SAMPLE_RESUME = """John Doe

EXPERIENCE
Senior Engineer | Acme Corp | 2020-present
- Led migration to Kubernetes
- Reduced deploy time by 40%

EDUCATION
BS Computer Science, MIT, 2015
"""

SAMPLE_COVER_LETTER = """Dear Hiring Manager,

I am writing to express my interest in the DevOps Engineer position at TechCo.

With 10 years of experience in infrastructure, I believe I would be a strong addition to your team.

Best regards,
John Doe"""


def test_generate_resume_pdf_returns_bytes():
    result = generate_resume_pdf(SAMPLE_RESUME)
    assert isinstance(result, bytes)
    assert len(result) > 0


def test_generate_resume_pdf_is_valid_pdf():
    result = generate_resume_pdf(SAMPLE_RESUME)
    doc = fitz.open(stream=result, filetype="pdf")
    assert doc.page_count >= 1
    doc.close()


def test_generate_resume_pdf_contains_text():
    result = generate_resume_pdf(SAMPLE_RESUME)
    doc = fitz.open(stream=result, filetype="pdf")
    text = doc[0].get_text()
    assert "John Doe" in text
    assert "EXPERIENCE" in text
    assert "Kubernetes" in text
    doc.close()


def test_generate_resume_pdf_metadata():
    result = generate_resume_pdf(SAMPLE_RESUME, name="John Doe")
    doc = fitz.open(stream=result, filetype="pdf")
    meta = doc.metadata
    assert "John Doe" in meta.get("title", "")
    assert "CareerPulse" in meta.get("creator", "")
    doc.close()


def test_generate_resume_pdf_name_from_content():
    result = generate_resume_pdf(SAMPLE_RESUME)
    doc = fitz.open(stream=result, filetype="pdf")
    meta = doc.metadata
    assert "John Doe" in meta.get("title", "")
    doc.close()


def test_generate_resume_pdf_custom_name():
    result = generate_resume_pdf(SAMPLE_RESUME, name="Jane Smith")
    doc = fitz.open(stream=result, filetype="pdf")
    meta = doc.metadata
    assert "Jane Smith" in meta.get("title", "")
    doc.close()


def test_generate_resume_pdf_empty_input():
    result = generate_resume_pdf("")
    assert isinstance(result, bytes)
    doc = fitz.open(stream=result, filetype="pdf")
    assert doc.page_count >= 1
    doc.close()


def test_generate_resume_pdf_long_content_paginates():
    long_resume = "Name Here\n\n" + "\n".join(
        f"Line {i}: Some content about experience and skills" for i in range(200)
    )
    result = generate_resume_pdf(long_resume)
    doc = fitz.open(stream=result, filetype="pdf")
    assert doc.page_count > 1
    doc.close()


def test_generate_cover_letter_pdf_returns_bytes():
    result = generate_cover_letter_pdf(SAMPLE_COVER_LETTER)
    assert isinstance(result, bytes)
    assert len(result) > 0


def test_generate_cover_letter_pdf_contains_text():
    result = generate_cover_letter_pdf(SAMPLE_COVER_LETTER, company="TechCo", position="DevOps")
    doc = fitz.open(stream=result, filetype="pdf")
    text = doc[0].get_text()
    assert "Dear Hiring Manager" in text
    assert "infrastructure" in text
    doc.close()


def test_generate_cover_letter_pdf_metadata_with_position():
    result = generate_cover_letter_pdf(SAMPLE_COVER_LETTER, company="TechCo", position="DevOps")
    doc = fitz.open(stream=result, filetype="pdf")
    meta = doc.metadata
    assert "DevOps" in meta.get("title", "")
    assert "TechCo" in meta.get("title", "")
    doc.close()


def test_generate_cover_letter_pdf_metadata_position_only():
    result = generate_cover_letter_pdf(SAMPLE_COVER_LETTER, position="SRE")
    doc = fitz.open(stream=result, filetype="pdf")
    meta = doc.metadata
    assert "SRE" in meta.get("title", "")
    doc.close()


def test_generate_cover_letter_pdf_metadata_no_args():
    result = generate_cover_letter_pdf(SAMPLE_COVER_LETTER)
    doc = fitz.open(stream=result, filetype="pdf")
    meta = doc.metadata
    assert "Cover Letter" in meta.get("title", "")
    doc.close()


def test_generate_cover_letter_pdf_empty():
    result = generate_cover_letter_pdf("")
    assert isinstance(result, bytes)
    doc = fitz.open(stream=result, filetype="pdf")
    assert doc.page_count >= 1
    doc.close()
