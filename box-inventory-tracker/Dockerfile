ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

ENV LANG C.UTF-8

RUN apk add --no-cache python3 py3-pip py3-virtualenv

WORKDIR /app

# Create a virtualenv to avoid system package conflicts
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

COPY app/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY app/ .
COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
