# Caddy + caddy-l4 (Apache-2.0, https://github.com/mholt/caddy-l4) — só pro
# modo TURN na 443 (TURN_443=1, ver docker-compose.turn443.yml). Versões
# fixas: caddy-l4 v0.1.2 exige Caddy v2.11.4.
ARG CADDY_VERSION=2.11.4
FROM caddy:${CADDY_VERSION}-builder AS builder
ARG CADDY_VERSION
ARG CADDY_L4_VERSION=v0.1.2
# GOTOOLCHAIN=auto: o caddy-l4 pede Go >= 1.25.1; se a imagem builder tiver
# um Go mais velho, o go baixa o toolchain certo sozinho.
ENV GOTOOLCHAIN=auto
RUN xcaddy build "v${CADDY_VERSION}" --with "github.com/mholt/caddy-l4@${CADDY_L4_VERSION}"

FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Falha o build se o módulo não entrou.
RUN caddy list-modules | grep -q '^layer4$'
