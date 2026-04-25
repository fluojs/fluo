<!-- packages: @fluojs/cli -->
<!-- project-state: FluoBlog v1.0 -->

# Chapter 2. Creating Your First Project with the CLI

In Chapter 1, you saw the ideas behind fluo. Now it is time to turn that philosophy into real directories and commands. By the end of this chapter, you will have a runnable FluoBlog starter, and you will understand why the generated files are placed where they are. Before building more architecture on top, you will secure a stable baseline that already works.

## Learning Objectives
- Learn how to install the fluo CLI globally or run it through a package runner.
- Scaffold a new project with the `fluo new` command.
- Analyze the generated project structure and the role of each directory.
- Understand the `package.json` scripts used for local development.
- Run the first FluoBlog setup and verify it.
- Build initial troubleshooting habits before moving to the next chapter.

## Prerequisites
- Node.js 18 or later.
- One package manager among npm, pnpm, or yarn.
- Completion of Chapter 1.
- A terminal session you can keep open throughout the exercises.

## 2.1 Installing @fluojs/cli

The first step looks simple, but it matters. The CLI prepares the working environment expected by the examples that follow.

The fluo CLI is the entrypoint for creating your first project. Instead of matching every configuration file by hand, you can start from a tool that already knows the framework's conventions.

Install it with your preferred package manager.

```bash
# Using npm
npm install -g @fluojs/cli

# Using pnpm
pnpm add -g @fluojs/cli

# Using yarn
yarn global add @fluojs/cli
```

After installation, check that the command is actually recognized.

```bash
fluo --version
```

If a version string is printed, your shell can find the executable correctly.

### Global vs Local CLI

When you are starting out, the simplest choice is usually a global install. It is also common in real work, but knowing the difference helps you make faster decisions later when you work with a team or CI. The point is not to memorize one correct option, but to choose based on the environment in front of you.

- **Global installation** is convenient in a personal development environment.
- **Local execution** through tools like `npx` or `pnpx` makes it easier to pin versions in CI.
- Team workflows may prefer local execution so everyone uses the same version.

All three approaches are valid. The key is to choose for the current situation, not out of habit.

### Verifying Your PATH

If `fluo --version` still fails after installation, the most common cause is your shell PATH.

In that case, check the following in order.

1. Confirm that the package manager installation completed successfully.
2. Open a new terminal window.
3. Run the version command again.
4. If it still fails, check your global binary path.

This is not a fluo-specific problem. It is a basic environment issue that often appears when installing a CLI tool for the first time.

### Why the Book Starts Here

This book starts with the CLI because it reduces setup noise. Without the CLI, you would need to make too many decisions at once from the moment you create the first project. Early on, the goal is to learn the framework structure, so it is safer to begin from trustworthy defaults.

- Package name,
- TypeScript configuration,
- Starter source structure,
- Development scripts,
- Runtime Bootstrap wiring.

The CLI gives you a trustworthy starting point. That lets you focus on how fluo structures an application instead of getting stuck on small setup details.

### Troubleshooting global installs

When a global install does not work as expected, the usual causes are permission issues or a Node.js version mismatch.

Some systems may require `sudo`, although npm does not recommend that. When possible, it is safer to manage Node.js installs without root privileges through a version manager such as `nvm` or `fnm`.

If you use pnpm, run `pnpm setup` and confirm that the global binary directory has been added to PATH.

### CLI as an Education Tool

The CLI is not only a tool for starting quickly. It is also a learning baseline that shows structure. By looking at which dependencies the CLI includes, how it configures TypeScript, and where it places files, you can learn the framework's best practices.

Pay close attention to the packages installed when you run `fluo new`. You will see modular components such as `@fluojs/core` and `@fluojs/http`. The important point is that fluo is not a huge monolithic framework. It is a collection of focused tools that you compose as needed.

### Staying Updated with the CLI

The fluo ecosystem evolves quickly. New features, security patches, and performance improvements are released regularly.

To keep getting the latest features and bug fixes, check for CLI updates from time to time.

```bash
# Using npm
npm update -g @fluojs/cli

# Using pnpm
pnpm update -g @fluojs/cli
```

A well-maintained CLI brings the latest community knowledge and framework benefits with it every time you start a new project.

## 2.2 fluo new: Interactive Scaffolding

Now that you can use the command, you do not need to create files one by one by hand. Let the generator establish a clean starting point first.

After installing the CLI, create the learning project for this book.

```bash
fluo new fluo-blog
```

This command starts an interactive wizard that asks for project information.

Typical questions include the following.

1. **Description**: A short description of the project.
2. **Version**: Usually `1.0.0` for a new app.
3. **Author**: The author name or team name.
4. **Package Manager**: The tool that the generated scripts will assume.

### What happens under the hood?

The generator is not just a folder-copying tool.

- It prepares the starter template.
- It records project metadata in `package.json`.
- It creates a source tree that follows fluo conventions.
- It installs the packages required to run the app.
- It leaves behind a structure you can read and run right away.

This process is useful for developers new to fluo because it turns the intent to study the framework into a concrete baseline that you can open and execute.

### Naming the Project Carefully

The project directory name stays with you longer than you might expect and becomes part of the development experience. `fluo-blog` is a good name for learning because it connects directly to the book project and stays easy to type repeatedly in the terminal.

- It is easy to read,
- It is easy to type,
- It connects directly to the flow of this book.

For real projects too, it is best to choose a name that is not too long and still shows the purpose.

### Interactive Flow vs Non-Interactive Flow

Many scaffolding tools support both interactive flows and flag-based automation flows.

In this chapter, the interactive flow is more helpful because each configuration choice appears in front of you. Later, automation becomes important for team templates or CI reproducibility. For now, it is better to look at each question and understand what the choice means.

### A Healthy Beginner Habit

Do not skip over the generator output. On the first run, you will see a short terminal summary at the end, and it contains the information you need to decide what to do next. It usually tells you the following.

- Which folder was created,
- Which dependencies were installed,
- Which command to run next,
- Whether there is anything to watch before running the app.

This habit will help you find problems faster later.

## 2.3 Analyzing the Project Structure

Right after generation finishes, it is better to read the structure before editing anything.

First, move into the new directory.

```bash
cd fluo-blog
```

The generated structure is intentionally small. It is designed so you can understand the whole project before adding new features.

```text
fluo-blog/
├── package.json              # Scripts and dependencies
├── pnpm-lock.yaml            # Locked dependency versions
├── tsconfig.json             # TypeScript configuration
└── src/                      # Application source
    ├── app.ts                # App assembly
    ├── hello.controller.ts   # Default HTTP route
    ├── hello.service.ts      # Route logic
    └── main.ts               # Bootstrap entrypoint
```

At this stage, each file answers questions that naturally come up when opening a project for the first time.

- Where does the app start?
- Where is the default app assembled?
- Which file handles the first HTTP response?
- Which scripts will you run most often?

### src/main.ts

`src/main.ts` may look like the smallest file, but its responsibility is very large. This file bootstraps the application because it is where framework configuration turns into a running server. As environment configuration, logging, and platform options are added later, this file becomes an even more important entrypoint.

### src/app.ts

`src/app.ts` is the assembly point for the default starter.

It may look small at first, but it helps you understand the real structure. By reading this file, you can immediately see which Controller and service the starter wires together by default.

As FluoBlog grows, this assembly point will become the starting place for more configuration in later chapters.

### package.json

At first, it is easy to see `package.json` as just a dependency list. In practice, it is also the project's command surface.

This file tells you the following.

- How to start local development,
- How to create a production build,
- How to run the compiled output,
- How linting or testing is connected.

### src/hello.controller.ts and src/hello.service.ts

These two files are the fastest proof that the default starter is an app that can actually respond.

The Controller exposes the default route, and the service provides the value returned by that route. At the beginning, reading only this pair lets you trace where a request enters and where the returned value is created.

### Reading Before Editing

Before changing anything, spend a few minutes reading the generated files. That short pause separates what the framework gives you by default from what you will change later, and it makes each file's responsibility easier to see.

1. What the framework gives you by default.
2. What you will change yourself in later chapters.
3. Which file owns which responsibility.

### Why the starter includes hello files

`hello.controller.ts` and `hello.service.ts` are the smallest example for verifying the first run.

Before adding complex domain code, they let you see where the default route and response come from. This starting point makes it easier to tell what was newly added when you change code in later chapters.

### Exploring the `node_modules` Folder (Briefly)

Beginners are usually told to ignore `node_modules`, but occasionally looking inside can help you understand the structure.

Under the `@fluojs` namespace, you can see the core framework logic. Notice how small these packages are. fluo's Standard-First philosophy shows up here too, because it uses native language features instead of leaning on massive external libraries.

Once you understand that the framework itself is just a well-organized collection of TypeScript code, the initial feeling of magic fades and the code becomes more approachable.

### Why TypeScript?

fluo is built on TypeScript, and the generated project reflects that.

You may wonder why it does not use plain JavaScript. TypeScript provides the following.

- **Autocomplete**: IDEs such as VS Code can help you find the right decorators and parameters.
- **Early error detection**: Many bugs are found while you write code, before you run the app.
- **Documentation expressed as code**: Types themselves act as documentation that stays current.

The CLI configures `tsconfig.json` for you with settings optimized for fluo. As the project grows, the compiler's ability to preserve consistency in the background becomes a major advantage.

## 2.4 Understanding package.json Scripts

After looking through the directory structure, the next step is to understand which commands you will use every day inside this project.

The generated project usually includes a small set of scripts that support the full initial development workflow.

- **`dev`**: Runs development mode for fast feedback.
- **`build`**: Compiles TypeScript into production output.
- **`start`**: Runs the built result.
- **`lint`**: Checks code quality when the starter provides it.

### Why `dev` matters most right now

In Part 0, `dev` is the command you will use most often. It keeps the feedback loop short, so the learning rhythm of changing code and checking the result stays intact.

- Change code,
- Save the file,
- Check the result,
- Repeat quickly.

That speed matters a lot while you are learning Modules, decorators, and routing.

### Why `build` still matters early

Even before deployment enters the picture, `build` matters because it verifies that the source compiles cleanly into production-ready output.

The recommended routine is as follows.

1. Use `dev` while changing code.
2. Run `build` when you want to confirm the project is still compilable.

### `start` is not the same as `dev`

It is better to learn this difference now. Once you know that the two commands run different targets, you can narrow down issues faster when development mode and built output behave differently.

- `dev` is optimized for iteration.
- `start` runs the build output.

If something works in `dev` but not in `start`, usually either the build or an environment assumption is wrong.

### Scripts as Team Language

Shared scripts also reduce confusion on a team.

When everyone uses the same command names, documentation gets shorter and onboarding gets easier. A good starter template provides that shared language from the first chapter.

## 2.5 FluoBlog: Initial Scaffolding and First Run

After reading the files, it is time to confirm that this scaffold is not only well organized, but also a project that is actually alive.

Run the project. This is the first check that the generated files are not only well organized, but can also bootstrap into a real application.

```bash
pnpm dev
```

If you chose npm or yarn during installation, use the matching equivalent command.

On the first run, the flow looks like this. You can expect startup logs similar to the following.

```text
[Fluo] Starting application...
[Fluo] AppModule initialized.
[Fluo] HTTP Server listening on port 3000.
```

These logs tell you something important. The framework loaded the root Module, completed Bootstrap, and bound the HTTP server.

### Verifying the Response

After the server starts, send a real request once.

```bash
curl http://localhost:3000/health
curl http://localhost:3000/hello
```

If you see `{"status":"ok"}` and `{"message":"Hello, World!"}`, the default health check and starter route are both working correctly according to the current contract.

### What You Actually Verified

When the first run succeeds, it is easy to underestimate what that request proves.

- The CLI generated a valid project.
- Dependencies were installed correctly.
- TypeScript compiled or transformed as expected in development mode.
- The runtime adapter started correctly.
- The default verification routes, `/health` and `/hello`, are reachable.

That is enough to give you a strong baseline for the chapters that follow.

### Common Beginner Issues

If the app does not start, check these causes first.

1. Did dependency installation fail halfway through?
2. Is another process already using port `3000`?
3. Did you use the wrong package manager command?
4. Is your Node.js version lower than the starter expects?

In most cases, reading the terminal output is enough to see the direction of the fix.

### Why We Start with the Default App

Some learners want to customize the starter right away.

That flow can work, but it is safer to verify the default app first and then edit it.

The default app is valuable because it provides a known-good state. If a new error appears after you add a Module or Controller later, it will be easier to tell that the problem came from your change rather than the initial scaffold.

### A Short Reflection Before Chapter 3

The goal at the end of this chapter is not just to say that you tried the generator once. The stronger goal is to verify a healthy starting state yourself and have a baseline for the architecture concepts in the next chapter.

- You know how the project was started.
- You know the role of the core files.
- You know how to run the app.
- You know what a healthy starter state looks like.

With that context, the Modules, Providers, and Controllers in the next chapter will be much easier to understand.

### Developing with a Plan

Even when working with your first project, it is better to start with a plan. Before jumping into code, first write down what you want to achieve.

1. **Understand the goal**: What problem are you trying to solve?
2. **Break it into steps**: What small steps are needed to reach that goal?
3. **Write it down**: Even a simple checklist like the one you are reading now can help you stay focused.

The FluoBlog project in this book will follow the same pattern. Each chapter defines a clear goal and implements it by breaking it into smaller steps. This disciplined approach helps you learn fluo much faster and more safely than simply coding as you go.

### The Joy of the First Green Log

There is a clear sense of achievement when the first `Application started successfully` log appears in the terminal.

That is the moment when an abstract concept becomes a program that actually runs. Instead of passing over it, take a moment to recognize that you have successfully set up a modern, high-performance backend environment.

Now you are ready to work directly with fluo's basic flow, which values standards, performance, and clean architecture.

### Learning from the Logs

The logs printed by fluo are not just status updates. They are diagnostic tools.

When an error occurs, read the stack trace first. It usually tells you exactly which file and line caused the problem. The habit of reading and understanding logs is a core backend development skill that will help you for a long time.

The more you interact with the framework through the CLI and logs, the more intuitive fluo will feel. It is similar to learning a new language. At first you follow the patterns the framework presents, but soon you will be able to adapt them to your project's situation.

## Summary
- The fluo CLI gives developers new to fluo a consistent starting point.
- `fluo new` scaffolds not just a folder, but files and conventions together.
- The generated source tree shows where Bootstrap, Module composition, and project metadata live.
- `dev`, `build`, and `start` each handle a different stage of the development lifecycle.
- The first successful request is strong evidence that the scaffold actually works.

The real result of this chapter is not simply that you ran the generator once. You now have a working starting state where you can build the architecture concepts from the next chapter.

## Next Chapter Preview
In the next chapter, you will build on the generated starter to explain the three core roles that appear throughout fluo: Modules, Providers, and Controllers. From that point on, FluoBlog will begin growing from a simple scaffold into your application structure.
