# Meridian toolchain image: everything needed to build the program, run every suite,
# run a local validator and run the ops/ staging scripts. Anchor matches .gitlab-ci.yml; Solana is newer (see below).
# Ubuntu 24.04 because the prebuilt Anchor 0.31.1 binary needs glibc >= 2.39.
FROM ubuntu:24.04

ARG RUST_VERSION=1.85.0
# 2.1.0 (CI pin) ships SBF platform-tools with Cargo 1.79, which cannot parse edition-2024 crates now in Cargo.lock
# (blake3 → digest 0.11, zeroize_derive 1.5). 4.3.0 builds the program as-is.
ARG SOLANA_VERSION=4.3.0
ARG ANCHOR_VERSION=0.31.1
ARG NODE_MAJOR=22

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config libssl-dev libudev-dev clang curl git jq python3 bzip2 ca-certificates gnupg socat \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
ENV PATH=/opt/cargo/bin:/root/.local/share/solana/install/active_release/bin:/root/.avm/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain ${RUST_VERSION}

RUN sh -c "$(curl -sSfL https://release.anza.xyz/v${SOLANA_VERSION}/install)" \
    && solana --version \
    # pull the SBF platform tools into the image so builds don't download at run time
    && cargo build-sbf --version

RUN cargo install --git https://github.com/coral-xyz/anchor --tag v${ANCHOR_VERSION} avm --locked \
    && avm install ${ANCHOR_VERSION} && avm use ${ANCHOR_VERSION} && anchor --version

# Node >= 22.18 strips TS types natively and loads .ts as ESM, which breaks the ts-node/mocha suites.
ENV NODE_OPTIONS=--no-experimental-strip-types

RUN corepack enable && yarn --version

WORKDIR /repo
