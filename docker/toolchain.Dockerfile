# Meridian toolchain image: everything needed to build the program, run every suite,
# run a local validator and run the ops/ staging scripts. Versions match .gitlab-ci.yml.
FROM node:22-bookworm

ARG RUST_VERSION=1.85.0
ARG SOLANA_VERSION=2.1.0
ARG ANCHOR_VERSION=0.31.1

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config libssl-dev libudev-dev clang curl git jq python3 bzip2 ca-certificates \
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

RUN corepack enable && yarn --version

# socat: loopback relay for the local web instance (docker/localnet/start.sh)
RUN apt-get update && apt-get install -y --no-install-recommends socat && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
