## [0.2.0] - 2026-04-06

> **@kb-labs/release-manager** 0.1.0 → 0.2.0 (minor: new features)

### ✨ New Features

- **release-manager**: Updates to CLI commands, changelog, plan, lockfile, tsconfig, and hooks enhance overall usability, ensuring a smoother experience when managing releases.
- **general**: The improved release planner, checks, build pipeline, and publisher streamline the release process, making it faster and more reliable for users.
- **release-manager**: Pipeline unification and scope resolution simplify the release management process, allowing for easier tracking and handling of changes.
- **release**: Complete pipeline unification means all handlers now utilize the core system, leading to a more consistent and efficient release workflow.
- **general**: Unifying the release pipeline ensures that verification and execution handlers are streamlined, which enhances performance and reliability.
- **general**: The unified release pipeline allows for better control over the flow, making the CLI and REST interfaces simpler and more efficient for users.
- **general**: Safe build enhancements and nested layout discovery improve project organization, while fixes for cross-repo dependencies enhance stability and functionality.
- **cli**: The addition of a changelog generator and OTP publish helper simplifies the publishing process, making it easier for users to manage their releases.
- **cli**: Introducing a new publish command provides a more straightforward way for users to deploy their updates with minimal effort.
- **changelog**: A professional footer and improved formatting enhance the readability and presentation of release notes, making it easier for users to understand changes.
- **release-manager**: Adding templates and overhauling CLI/reporting improves clarity and efficiency, allowing users to generate reports more effectively.
- **release-manager**: Revamping the changelog pipeline and CLI ensures that users have a more intuitive interface and streamlined process for tracking changes.
- **release-manager**: Refreshing CLI commands and setup enhances usability, making it easier for users to get started and manage their configurations.
- **release**: New packages and updated configurations expand functionality, providing users with more tools and options for their projects.
- **contracts**: Introducing the contracts package and migrating the manifest to Level 2 enhances compatibility and offers users improved contract management capabilities.
- **commands**: Adding explicit flags and result types for release commands increases clarity and reduces errors, leading to a smoother user experience.
- **architecture**: Implementing a domain-driven architecture helps organize the codebase more effectively, resulting in improved performance and maintainability for users.
- **docs**: Standardizing the ADR format with metadata improves documentation consistency, making

### 🐛 Bug Fixes

- **release**: Introduces a changelog for the REST run-handler, ensuring users can easily track updates and changes made to the software, enhancing transparency and user awareness.
- **general**: Adds ESLint as a development dependency for release-manager packages, helping maintain code quality and reducing the likelihood of bugs in future updates.
- **release-manager-changelog**: Updates the test command to allow for scenarios without tests, improving flexibility in the development process and ensuring smoother releases.
- **docs**: Updates the "Last Updated" date to November 2025, providing users with the most current information about the documentation and its relevance.
- **docs**: Corrects a typo in the ADR filename, ensuring users can accurately reference documentation without confusion.
