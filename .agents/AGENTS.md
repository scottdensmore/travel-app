# travel-app Workspace Agent Rules

These rules govern all features, bug fixes, and development work in this repository. All agents and sub-agents MUST strictly adhere to these rules.

## 1. Branching Strategy
- **No Direct Commits**: Never commit directly to the `main` branch.
- **Feature/Fix Branches**: All work must be completed in a dedicated feature, bugfix, or chore branch (e.g., `feature/user-auth`, `bugfix/fix-trip-map`).
- **Branch Creation**: Create branches from the latest `main` branch state.

## 2. Test-Driven Development (TDD)
- **Test-First Principle**: For all additions or modifications, write failing tests first that capture the intended behavior or regression.
- **Implement Minimal Code**: Implement the minimal necessary code to make the tests pass.
- **Refactor Safely**: Refactor with confidence, ensuring the test suite remains green.
- **Preserve Existing Tests**: Run the full test suite to ensure no regressions occur.

## 3. User Journey & Functional Testing
- **End-to-End/Functional Coverage**: Beyond simple unit tests, write comprehensive functional tests that mock external boundaries and exercise full user journeys (e.g., user registration flow, trip booking flow).
- **Framework**: Use Jest with `@testing-library/react` and/or `jest-environment-jsdom` as configured in the project.

## 4. Pre-Commit Code Review
- **Sub-Agent Validation**: Before committing any code or creating a PR, invoke the `code_reviewer` sub-agent.
- **Provide Context**: Pass the git diff and any newly written test files to the `code_reviewer`.
- **Address Feedback**: Do not commit until the `code_reviewer` gives an explicit **APPROVE** decision. If changes are requested, address them in a TDD fashion.

## 5. Pull Requests & Continuous Integration
- **Create PR**: Once code is approved by the `code_reviewer`, push the branch and create a Pull Request.
- **Wait for Checks**: Wait for all CI checks and tests to pass.
- **No Force-Merging**: Never bypass failing checks. Resolve all test and lint failures on the branch.

## 6. Squash and Merge Strategy
- **Clean History**: All approved and passing PRs must be merged using the **Squash and Merge** strategy to maintain a clean, linear git history.

## 7. Containerization / Docker Fallback
- **Podman / Podman-compose Fallback**: On this machine, Podman is installed instead of Docker. If `docker` or `docker-compose` commands are not present or fail, always fall back to `podman` and `podman-compose` respectively.

