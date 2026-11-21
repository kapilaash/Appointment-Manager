FROM python:3.12-slim

WORKDIR /app
COPY app/observability/heartbeat.py ./heartbeat.py

USER 65534:65534
EXPOSE 9100
ENTRYPOINT ["python", "/app/heartbeat.py"]
