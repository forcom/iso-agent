FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RULES_PATH=/app/rules.dl
WORKDIR /app
COPY apps/engine/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/packages/ontology/rules.dl ./rules.dl
COPY apps/engine/wirelog.py apps/engine/server.py ./
RUN useradd --uid 10001 --create-home engine
USER engine
EXPOSE 8080
CMD ["python", "server.py"]
