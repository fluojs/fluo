<!-- packages: @fluojs/cli -->
<!-- project-state: FluoBlog v1.0 -->

# Chapter 2. Creating Your First Project with the CLI

## Learning Objectives
- Install the fluo CLI tool globally or invoke it through a package runner.
- Use `fluo new` to scaffold a fresh project.
- Analyze the generated project structure and directory roles.
- Understand the `package.json` scripts used during local development.
- Verify the first FluoBlog setup by running the application.
- Learn a few beginner troubleshooting habits before moving on.

## Prerequisites
- Node.js 18 or newer.
- A package manager such as npm, pnpm, or yarn.
- Completed Chapter 1.
- A terminal session you can keep open while experimenting.

## 2.1 Installing @fluojs/cli

The fluo CLI is the entry point for the beginner workflow. Instead of manually assembling every config file, you begin with a tool that already understands the conventions of the framework.

Install it with your preferred package manager.

```bash
# Using npm
npm install -g @fluojs/cli

# Using pnpm
pnpm add -g @fluojs/cli

# Using yarn
yarn global add @fluojs/cli
```

After installation, confirm that the command is available.

```bash
fluo --version
```

If the command prints a version string, your shell can find the executable.

### Global vs Local CLI

Beginners often choose a global install because it is the easiest way to get started.

That choice is fine, but it helps to know the trade-off.

- A **global** install is convenient on your machine.
- A **local** invocation through `npx` or `pnpx` is easier to pin in CI.
- Teams sometimes prefer local invocation so every contributor runs the same version.

All three approaches can work. The key is to be intentional.

### Verifying Your PATH

If `fluo --version` fails after installation, the most common issue is your shell PATH.

Use this short checklist.

1. Confirm the package manager completed successfully.
2. Open a new terminal window.
3. Re-run the version command.
4. Check the package manager's global bin path if the command is still missing.

This is not a fluo-specific problem. It is a normal part of CLI-based tooling on any platform.

### Why the Book Starts Here

The CLI matters because it reduces setup noise.

Without it, a beginner would need to make many early decisions all at once.

- package names,
- TypeScript config,
- starter source layout,
- dev scripts,
- and runtime bootstrap wiring.

The CLI gives you a reliable starting point so you can spend your mental energy on framework concepts instead of setup trivia.

### Troubleshooting global installs

If the global install doesn't work as expected, it's often due to permission issues or Node.js version mismatches. 

On some systems, you might need to use `sudo` (not recommended for npm) or, better yet, use a version manager like `nvm` or `fnm` to manage your Node.js installations without needing root permissions.

If you are using `pnpm`, make sure you have run `pnpm setup` to add the global bin directory to your PATH.

### CLI as an Education Tool

The CLI isn't just for speed; it's a teacher. By looking at the choices it makes—which dependencies it includes, how it configures TypeScript, and where it places files—you are learning the framework's best practices. 

When you run `fluo new`, pay attention to the packages it installs. You'll see `@fluojs/core`, `@fluojs/http`, and other modular components. This shows you that fluo is not a monolithic framework, but a collection of specialized tools that you can mix and match.

### Staying Updated with the CLI

The fluo ecosystem moves fast. New features, security patches, and performance improvements are released regularly. 

To ensure you have the latest features and bug fixes, periodically check for updates to the CLI:

```bash
# Using npm
npm update -g @fluojs/cli

# Using pnpm
pnpm update -g @fluojs/cli
```

A well-maintained CLI ensures that every new project you start benefits from the latest community knowledge and framework advancements. It's a small habit that keeps your development environment healthy and efficient.

## 2.2 fluo new: Interactive Scaffolding

Once the CLI is installed, create the learning project for this book.

```bash
fluo new fluo-blog
```

This command launches an interactive wizard that asks for project details.

Typical prompts include:

1. **Description**: a short summary of the project.
2. **Version**: usually `1.0.0` for a new app.
3. **Author**: your name or team label.
4. **Package Manager**: the tool the generated scripts should expect.

### What happens under the hood?

The generator is doing more than copying a folder.

- It prepares a starter template.
- It writes project metadata into `package.json`.
- It creates a source tree that matches fluo conventions.
- It installs the packages needed to run the app.
- It leaves you with a structure that is ready to inspect immediately.

For beginners, this matters because it turns “I want to learn the framework” into “I have a working baseline to study.”

### Naming the Project Carefully

The directory name you choose becomes part of your developer experience.

`fluo-blog` is a good learning name because it is:

- easy to read,
- easy to type,
- and clearly connected to the book narrative.

In real projects, teams should prefer names that are specific enough to communicate purpose without becoming overly long.

### Interactive Flow vs Non-Interactive Flow

Many scaffolding tools support both interactive prompts and flag-based automation.

For this beginner chapter, the interactive flow is useful because it makes each setup decision visible. Later, automation becomes important when teams want reproducible scripts for CI or internal templates.

### A Healthy Beginner Habit

Do not rush past the generator output.

Read the final terminal summary carefully.

It usually tells you:

- which folder was created,
- which dependencies were installed,
- which command to run next,
- and whether anything needs attention before startup.

## 2.3 Analyzing the Project Structure

After generation finishes, move into the new directory.

```bash
cd fluo-blog
```

The generated structure is intentionally small so you can understand it before adding new features.

```text
fluo-blog/
├── src/                # Application source
│   ├── app.module.ts   # Root module
│   └── main.ts         # Bootstrap entrypoint
├── test/               # Integration or e2e tests
├── tsconfig.json       # TypeScript configuration
├── package.json        # Scripts and dependencies
└── .fluo.json          # CLI metadata
```

At this stage, every file answers a different beginner question.

- Where does the app start?
- Which module is currently the root?
- Which scripts will I run most often?
- Which tool remembers project metadata for future generation commands?

### src/main.ts

`src/main.ts` is usually the smallest file with the biggest responsibility.

It bootstraps the application.

That means it is the place where framework setup turns into a running server. Later, when you need environment configuration, logging, or platform options, this file becomes one of the most important entry points in the project.

### src/app.module.ts

`AppModule` is the root composition point.

At the beginning it may look almost empty, but that simplicity is helpful. It teaches you that modules are not magic folders. They are explicit composition units.

As FluoBlog grows, this module will import other domain modules and establish the top-level shape of the application.

### package.json

Beginners often treat `package.json` as a dependency list only. In practice, it is also your command surface.

This is where you discover how the framework expects you to:

- start local development,
- build for production,
- run compiled output,
- and sometimes lint or test the app.

### .fluo.json

This file exists to help the CLI understand your project later.

Think of it as a small contract between the generator and future code generation commands. It is not glamorous, but it is useful, and beginners should know it exists before they accidentally delete it.

### Reading Before Editing

Before you change anything, spend a few minutes reading the generated files.

That deliberate pause helps you separate three ideas.

1. What the framework gives you by default.
2. What you will customize in later chapters.
3. Which file owns which responsibility.

### The Role of .fluo.json

As mentioned earlier, `.fluo.json` is a metadata file that helps the CLI track your project's state. It includes information like the project name, the version of fluo used for scaffolding, and any custom templates applied. 

Avoid editing this file manually unless you are an advanced user. If this file is corrupted or deleted, some CLI commands (like adding new modules or controllers automatically) might stop working. Keeping it intact ensures that your project remains "CLI-compatible" throughout its development lifecycle.

### Exploring the `node_modules` Folder (Briefly)

While beginners are usually told to ignore `node_modules`, taking a quick peek can be enlightening. 

You'll see the `@fluojs` namespace containing the core framework logic. Notice how small these packages are. This is a direct result of fluo's "Standard-First" philosophy—it relies on native language features rather than massive external libraries. 

Understanding that the framework itself is just a collection of well-organized TypeScript code can demystify much of the "magic" you might feel as a newcomer. It's all just code, and the more you look at it, the more familiar it will become.

### Why TypeScript?

Fluo is built on TypeScript, and the generated project reflects this. 

You might wonder why we don't just use plain JavaScript. TypeScript provides:

- **Autocompletion**: Your IDE (like VS Code) will help you find the right decorators and parameters.
- **Early Error Detection**: Many bugs are caught while you type, rather than when you run the app.
- **Documentation as Code**: The types themselves act as a form of documentation that never goes out of date.

The CLI configures `tsconfig.json` for you with the optimal settings for fluo. As you grow as a developer, you'll appreciate how much more confident you feel when the compiler has your back.

## 2.4 Understanding package.json Scripts

The generated project normally includes a small set of scripts that support the whole beginner workflow.

- **`dev`**: runs the application in development mode with fast feedback.
- **`build`**: compiles TypeScript into production-ready output.
- **`start`**: runs the compiled build.
- **`lint`**: checks code quality and style when provided by the starter.

### Why `dev` matters most right now

For Part 0, `dev` is the command you will use the most.

It shortens the feedback loop.

- edit code,
- save the file,
- observe the result,
- repeat quickly.

That speed is important when you are still learning modules, decorators, and routing.

### Why `build` still matters early

Even before deployment enters the story, `build` is useful because it verifies that your source can be compiled cleanly.

A healthy beginner routine is:

1. use `dev` while changing code,
2. use `build` when you want confirmation that the project is in a production-compilable state.

### `start` is not the same as `dev`

This distinction is worth learning now.

- `dev` optimizes for iteration.
- `start` runs built output.

If something works in `dev` but not in `start`, that usually reveals a build or environment assumption that needs attention.

### Scripts as Team Language

Shared scripts also reduce team confusion.

When everyone uses the same command names, docs stay shorter and onboarding gets easier. A good starter template gives that common language to you from the first chapter.

## 2.5 FluoBlog: Initial Scaffolding and First Run

Now run the project.

```bash
pnpm dev
```

If you chose npm or yarn during setup, use the equivalent command for that package manager.

You should expect startup logs similar to these.

```text
[Fluo] Starting application...
[Fluo] AppModule initialized.
[Fluo] HTTP Server listening on port 3000.
```

These messages tell you something important: the framework loaded the root module, finished bootstrapping, and bound an HTTP server.

### Verifying the Response

After startup, make one request to the app.

```bash
curl http://localhost:3000
```

A simple starter response such as `{"message":"Hello fluo!"}` confirms that the request path, runtime bootstrap, and starter controller are functioning together.

### What You Actually Verified

This first successful request proves more than beginners often realize.

- The CLI generated a valid project.
- Dependencies installed correctly.
- TypeScript compiled or transpiled as expected for dev mode.
- The runtime adapter started successfully.
- The initial controller route is reachable.

That is a strong baseline for the chapters ahead.

### Common Beginner Issues

If the app does not start, check these common causes first.

1. The dependency install failed partway through.
2. Another process is already using port `3000`.
3. The wrong package manager command was used.
4. Node.js is older than the starter expects.

In most cases, the fix is straightforward once you read the terminal output carefully.

### Why We Start with the Default App

Some learners feel tempted to customize the starter immediately.

Resist that urge for a moment.

The default app is valuable because it gives you a known-good reference state. When you later add modules or controllers, you will know that any new failure came from your change rather than from the initial scaffold.

### A Short Reflection Before Chapter 3

At the end of this chapter, your goal is not merely “I ran a generator.”

Your real goal is stronger.

- You know how the project started.
- You know what the core files are for.
- You know how to run the app.
- You know what a healthy starter state looks like.

That context makes the next chapter on modules, providers, and controllers much easier to understand.

### Developing with a Plan

Even as a beginner, it's good to start with a plan. Before you dive into the code, take a moment to think about what you want to achieve.

1. **Understand the Goal**: What problem are you trying to solve?
2. **Break it Down**: What are the smaller steps needed to reach that goal?
3. **Write it Down**: A simple checklist (like the one you're reading now!) can keep you focused and motivated.

The FluoBlog project we are building together will follow this pattern. In each chapter, we'll define a clear goal and then implement it step-by-step. This disciplined approach will help you master fluo more quickly and effectively than just "hacking away."

### The Joy of the First Green Log

There is a special kind of satisfaction in seeing that first "Application started successfully" log in your terminal. 

It marks the moment when an abstract concept becomes a living, breathing program. Don't rush past this moment. Take a second to appreciate that you've successfully set up a modern, high-performance backend environment. 

You are now part of a growing community of developers who prioritize standards, performance, and clean architecture. Welcome to the fluo family!

### Learning from the Logs

The logs that fluo prints are not just status updates; they are a diagnostic tool. 

If you see an error, don't panic. Read the stack trace. It usually tells you exactly which file and line number caused the problem. Developing the habit of reading and understanding logs is one of the most important skills you can acquire as a backend developer. 

The more you interact with the framework through the CLI and logs, the more intuitive it will become. It's like learning a new language—at first, you're just repeating phrases, but soon you'll be composing your own sentences.

## Summary
- The fluo CLI gives beginners a consistent starting point.
- `fluo new` scaffolds both files and conventions, not just folders.
- The generated source tree teaches where bootstrap, module composition, and project metadata live.
- `dev`, `build`, and `start` serve different parts of the development lifecycle.
- A successful first request proves the scaffold is genuinely working.

## Next Chapter Preview
In the next chapter, we will take the generated starter and explain the three core architectural roles you will keep seeing in fluo: modules, providers, and controllers. That is where FluoBlog stops being only a scaffold and starts becoming your own application structure.
