# syntax=docker/dockerfile:1.7
FROM golang:1.25-alpine AS builder
ENV GOTOOLCHAIN=auto
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod     --mount=type=cache,target=/root/.cache/go-build     go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod     --mount=type=cache,target=/root/.cache/go-build     CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /out/pulseops ./cmd/pulseops

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata iputils iperf3 wget openssh-client net-snmp-tools
ENV PULSEOPS_WEB_DIR=/opt/pulseops/web
WORKDIR /opt/pulseops
RUN adduser -D -H -u 10001 pulseops
COPY --from=builder /out/pulseops /usr/local/bin/pulseops
COPY web /opt/pulseops/web
RUN mkdir -p /var/lib/pulseops /etc/pulseops && chown -R pulseops:pulseops /var/lib/pulseops
EXPOSE 8765
USER pulseops
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s CMD wget -qO- http://127.0.0.1:8765/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/pulseops"]
CMD ["-config", "/etc/pulseops/config.yml", "-data", "/var/lib/pulseops", "-addr", ":8765"]
