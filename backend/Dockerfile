FROM messense/rust-musl-cross:aarch64-musl AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release --target aarch64-unknown-linux-musl
COPY migrations migrations
COPY src src
RUN touch src/main.rs
RUN cargo build --release --target aarch64-unknown-linux-musl

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /app/target/aarch64-unknown-linux-musl/release/kubero-wrapper /usr/local/bin/
COPY migrations /app/migrations
WORKDIR /app
CMD ["kubero-wrapper"]
