FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /casa-files-server .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates mailcap tzdata
COPY --from=build /casa-files-server /usr/local/bin/casa-files-server
ENV STORAGE_ROOT=/data PORT=8088
EXPOSE 8088
ENTRYPOINT ["casa-files-server"]
