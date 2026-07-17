FROM docker:27-cli

# git para el pull, docker-cli-compose para "docker compose" dentro del contenedor
RUN apk add --no-cache git docker-cli-compose

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
