FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DCM_DATABASE_PATH=/app/data/dcm.sqlite3

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY datacontracts/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

COPY datacontracts ./datacontracts

RUN mkdir -p /app/data && chown -R app:app /app

USER app

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "datacontracts.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
