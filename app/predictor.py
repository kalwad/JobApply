import logging

from app.ai_client import AIClient, parse_json_response

logger = logging.getLogger(__name__)

PREDICTION_PROMPT = """You are a job application success predictor.

Given the user's application history and a new job, estimate the probability of success.

APPLICATION HISTORY SUMMARY:
{history}

NEW JOB:
Title: {title}
Company: {company}
Description: {description}

Return ONLY valid JSON:
{{
    "probability": <0-100 integer, likelihood of getting an interview/offer>,
    "confidence": "<low/medium/high> — how confident you are in this estimate",
    "reasoning": ["reason 1", "reason 2", "reason 3"]
}}

Consider: match between user's background and role, company response patterns, score calibration data."""


async def predict_success(client: AIClient, history: str,
                           title: str, company: str, description: str) -> dict:
    prompt = PREDICTION_PROMPT.format(
        history=history, title=title, company=company, description=description,
    )
    try:
        raw = await client.chat(prompt, max_tokens=512)
        return parse_json_response(raw)
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        return {"probability": 0, "confidence": "low", "reasoning": [f"Prediction error: {e}"]}
