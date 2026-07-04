# Contributing to Open Snipping

First off, thank you for considering contributing to Open Snipping! It's people like you that make open-source tools great.

## Development Environment Setup

1. Make sure you have Node.js (v20+), Rust, and standard Linux build tools installed.
2. We highly recommend using the provided `Dockerfile` if you want a clean build environment without installing dependencies on your host.

## Commit Message Guidelines

We use **Conventional Commits** to auto-generate our changelog and releases. Every commit message must follow this structure:

```
<type>(<scope>): <subject>
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries such as documentation generation

### Example Commit Messages

- `feat(overlay): add support for multiple monitors`
- `fix(wayland): resolve black screen issue on capture`
- `docs: update installation instructions in README`

Please enforce these rules locally to ensure a smooth PR process. We will squash and merge PRs using this format.

## Submitting a Pull Request

1. Fork the repository and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. Ensure the test suite passes.
4. Make sure your code follows our style guidelines (English-only codebase).
5. Open a Pull Request with a clear title and description.
