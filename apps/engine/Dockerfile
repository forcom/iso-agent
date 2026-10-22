FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn pyrewire==1.1.2 || \
    pip install --no-cache-dir fastapi uvicorn

COPY server.py rules.dl ./

ENV PORT=8080
EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
