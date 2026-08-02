FROM python:3.12-alpine

WORKDIR /app

COPY index.html styles.css app.js server.py ./

RUN mkdir -p /app/data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python3 -c "from urllib.request import urlopen; assert urlopen('http://127.0.0.1:8080/healthz').read() == b'ok'"

CMD ["python3", "server.py"]
