<!-- packages: @fluojs/http, @fluojs/validation -->
<!-- project-state: FluoBlog v1.3 -->

# Chapter 6. Request Data and DTO Validation

If Chapter 5 built the skeleton of routes and controllers, this chapter handles the data that crosses that boundary more safely. Here, we attach DTOs and validation rules to FluoBlog request input so the contract between the transport layer and service logic becomes clear.

## Learning Objectives
- Understand why DTOs are better than loose request objects.
- Use validation decorators that describe FluoBlog post creation input.
- Generate a request DTO file with the CLI and understand where it fits.
- Learn how `@RequestDto()` connects HTTP binding and DTO materialization.
- Apply optional and partial DTO patterns to update operations.
- Understand why fluo avoids implicit scalar coercion.
- Define a cleaner boundary between transport data and service logic.

## Prerequisites
- Completed Chapter 5.
- Basic understanding of the `PostsController` route examples.
- Familiarity with TypeScript classes and properties.
- Comfort reading short validation examples.

## 6.1 Why Loose Input Becomes a Problem Quickly

In Chapter 5, the create route accepted a plain object directly. That was enough while introducing routing, but it is not enough as a long-term input strategy.

A plain object cannot tell you which fields are required, which values must be strings, or which rules define optional input. More than anything, it cannot protect the service boundary. DTOs solve this by giving request data a named shape, and validation decorators turn that shape into an executable contract.

```typescript
class CreatePostDto {
  title = '';
  body = '';
}
```

Even without validation rules yet, this code is already easier to read than an anonymous inline object. The class name tells you what the payload is for, and the properties show what the route expects.

### DTOs Are a Boundary Tool

A DTO is not just a TypeScript convenience. It is a tool for creating a transport boundary. Outside the boundary, clients send unknown input, and inside the boundary, services expect a trustworthy structure. Validation makes that transition safe and makes the expected request shape clear before data reaches service logic.

### Why Classes instead of Interfaces?

You might wonder why DTOs use TypeScript classes instead of interfaces. In TypeScript, interfaces are erased during compilation, so they do not exist at runtime. Classes, on the other hand, are part of the JavaScript standard and remain present at runtime. fluo uses that runtime presence to attach validation metadata through decorators. That is not possible with plain interfaces.

## 6.2 Defining CreatePostDto with Validation Rules

Now let’s add rules that describe what a valid post creation request means in FluoBlog.

```typescript
import { IsBoolean, IsOptional, IsString, MinLength } from '@fluojs/validation';

export class CreatePostDto {
  @IsString()
  @MinLength(3)
  title = '';

  @IsString()
  @MinLength(10)
  body = '';

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
```

This class now plays three useful roles. It names the request, documents the expected fields, and defines runtime validation rules. Together, those roles move FluoBlog from an API that simply has routes to an API that is safer.

### Starting the DTO file with the CLI

You can write `CreatePostDto` by hand, and doing so is useful while learning. The current CLI can also create the request DTO file in the feature directory for you.

```bash
fluo generate request-dto posts CreatePost
fluo g request-dto posts UpdatePost --dry-run
```

The command keeps the feature directory and DTO class name separate. In this example, `posts` points to the `src/posts/` slice, while `CreatePost` is the DTO class name. That means `CreatePostDto` and `UpdatePostDto` can live beside each other in the same feature without guessing from a single combined name.

Use `--dry-run` first when you want to see the target path and file-write plan without changing the project. After generation, you still read the file, add or adjust validation decorators, and connect the class to the controller with `@RequestDto(CreatePostDto)`. The generator creates the starting file. `@RequestDto()` is what makes the HTTP route use that DTO at runtime.

### Why Field Defaults Help Beginners

You will often see examples where DTO fields are initialized with simple defaults. This pattern makes the class easier to materialize and inspect visually, and it helps readers who are new to class-based validation follow the flow. Defaults act like small signposts that make the example's intent easier to see.

### What These Rules Mean

`title` must be a string and at least three characters long, and `body` must be a string and at least ten characters long. `published` can be omitted, but if it exists, it must be a boolean. The rules are small, but even this much is enough to leave the request contract clearly in code and show the value of catching invalid input early.

### Why Decorators?

fluo uses decorators like `@IsString()` directly on class properties. This declarative style is characteristic of the fluo framework. Instead of writing long `if/else` blocks to check data, you declare what the data should be. That lets a DTO act as both code and documentation, and it keeps rules close to the data they protect.

### Common Validation Decorators

The `@fluojs/validation` package provides a broad set of decorators for many data types.

- **String checks**: `@IsString()`, `@MinLength()`, `@MaxLength()`, `@IsEmail()`, `@IsUrl()`
- **Number checks**: `@IsNumber()`, `@Min()`, `@Max()`, `@IsInt()`
- **Type checks**: `@IsBoolean()`, `@IsDate()`, `@IsEnum()`, `@IsArray()`
- **Presence checks**: `@IsOptional()`, `@IsNotEmpty()`, `@IsDefined()`

You do not need to memorize all of them. Just remember that if you have a common data requirement, there is a good chance a decorator already exists for it.

## 6.3 Connecting DTOs to the HTTP Layer

Validation only becomes meaningful when the controller actually asks for DTO materialization.

That is the role of `@RequestDto()`.

```typescript
import { Controller, Post, RequestDto } from '@fluojs/http';
import { CreatePostDto } from './create-post.dto';

@Controller('/posts')
export class PostsController {
  @Post('/')
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return input;
  }
}
```

Once this decorator is attached, the HTTP layer no longer passes the raw body through unchanged. It binds request data, materializes a DTO instance, and validates the result before the service sees it. That is exactly the sequence we want at the transport boundary because the service can now assume it receives organized input.

### `materialize()` vs Plain Assignment

The validation package distinguishes between creating a typed instance and validating an existing value. HTTP binding usually needs the first path because it must take unknown input and turn it into a DTO instance. That is why the documentation emphasizes `materialize()`, which handles hydration and validation together. The root payload must be a plain object or an instance of the target DTO; malformed roots such as strings, arrays, and `null` are rejected before the DTO constructor or field defaults run. The key point you need now is simple: incoming payloads should first be checked as a valid object boundary, then converted into a known DTO shape before business logic runs.

### The Role of Metadata

Internally, `@fluojs/validation` uses the class as a blueprint. It reads decorators to understand what the data should look like. When `materialize` is called, incoming data is compared against that blueprint. This is one reason fluo is efficient. Instead of using slow, heavy reflection for every request, it uses the structured metadata that was already provided.

## 6.4 Updating FluoBlog Create and Update Flows

Now let’s change the post service to use DTO-based input.

We will prepare an update DTO too.

```typescript
import { PartialType } from '@fluojs/validation';

export class UpdatePostDto extends PartialType(CreatePostDto) {}
```

This code is a good early example of a mapped DTO helper.

`PartialType(CreatePostDto)` means every field from the create DTO becomes optional in the update DTO.

That matches the usual meaning of patch-style updates.

Now the controller can use both DTOs.

```typescript
import { Controller, Patch, Post, RequestContext, RequestDto } from '@fluojs/http';
import { CreatePostDto } from './create-post.dto';
import { UpdatePostDto } from './update-post.dto';

@Controller('/posts')
export class PostsController {
  @Post('/')
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input);
  }

  @Patch('/:id')
  @RequestDto(UpdatePostDto)
  update(input: UpdatePostDto, requestContext: RequestContext) {
    return this.postsService.update(requestContext.request.params.id, input);
  }
}
```

This is a meaningful upgrade for FluoBlog. The create route now has explicit rules, and the update route clearly communicates partial update semantics while keeping the current handler contract in the form `input + requestContext`. It also stays behaviorally connected to the original create rules, so the same contract can be extended without duplication.

### Why Mapped DTO Helpers Matter

At first, it is easy to write similar DTOs by hand, and that works in the beginning. But it quickly becomes repetitive and prone to mistakes. Helpers such as `PartialType`, `PickType`, and `OmitType` reduce duplication while preserving validation metadata, so derived contracts can stay tied to one base DTO safely.

### Creating Specific DTO Variations

For example, if you need a DTO that includes only the title, you can write this.

```typescript
export class UpdateTitleDto extends PickType(CreatePostDto, ['title']) {}
```

Or, if you want to exclude a specific field, you can write this.

```typescript
export class PublicCreateDto extends OmitType(CreatePostDto, ['published']) {}
```

These utilities let you define validation rules **once** in the base DTO and reuse them across the application. This is how the "DRY" (Don't Repeat Yourself) principle applies to DTO design.

## 6.5 No Implicit Scalar Coercion

There is one detail in the validation package documentation that deserves special attention.

The validator is intentionally strict. If the transport layer gives it `'42'` but the DTO expects a `number`, it does not quietly treat the string as if it had already been a number.

This is a healthy design choice. Silent coercion can hide bugs and make input behavior hard to predict. As Part 1 later covers failure paths too, this explicitness becomes even more important.

### What This Means for FluoBlog

Imagine adding query parameters such as `?page=2` or `?limit=10` later.

Those values arrive as transport data, not automatically trustworthy application numbers. If conversion is needed, it should be handled deliberately in the binding or transport layer. That explicitness keeps validation honest and makes it possible to explain when and where input changed shape.

### Beginner Rule of Thumb

Do not assume the network sends the exact type you want. Describe the type you expect, validate it, and convert only when you can explain where that conversion belongs. This rule prevents subtle bugs later and keeps input responsibilities clear.

### Converting Query Parameters

If you really need to accept a number from a query parameter, bind it to a DTO first, then make the conversion explicit in code.

```typescript
class ListPostsQueryDto {
  page = '1';
}

@Get('/')
@RequestDto(ListPostsQueryDto)
findAll(input: ListPostsQueryDto) {
  const page = Number.parseInt(input.page, 10);
  return this.postsService.findAll(page);
}
```

This makes the conversion process explicit and visible. First you fix the DTO input contract, then you show the required conversion in code.

## 6.6 What FluoBlog Looks Like After Validation

The posts feature now has a more realistic structure. Routing is still important, but the service is no longer exposed directly to shapeless input. That is a major architectural improvement because the service boundary can stay safer as persistence or authentication is added later.

```typescript
// src/posts/posts.service.ts
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';

export class PostsService {
  create(input: CreatePostDto) {
    return {
      id: '2',
      title: input.title,
      body: input.body,
      published: input.published ?? false,
    };
  }

  update(id: string, input: UpdatePostDto) {
    return { id, ...input };
  }
}
```

The service signatures are much clearer now. Another developer can immediately see that create and update expect validated DTOs. That clarity makes later refactoring easier and leaves the responsibility for input validation in an obvious place.

### Reliability and Trust

When you know input is valid, you can write simpler service code. You do not need to repeat checks such as `if (input.title.length < 3)` inside the service, because you know the DTO has already handled them. This separates responsibilities between the transport layer and business logic, so each part of the system can focus on its own role.

### Common Beginner Mistakes with Validation

- Leaving inline object types on controller methods even though a DTO already exists.
- Adding validation decorators but forgetting `@RequestDto()`.
- Generating a request DTO file and assuming it is active before the controller references it with `@RequestDto()`.
- Expecting query strings to become numbers automatically.
- Manually copying create DTO fields into an update DTO instead of using a mapped helper.
- Treating DTO classes like domain models instead of transport-boundary models.

### Why This Chapter Stops Before Error Details

Once validation exists, readers naturally ask what happens when it fails. That is a very good question, and we will cover the answer soon. But first, we also need to define the shape of successful responses. It is better to decide what successful output should look like before covering every error path.

## Summary
- DTOs turn loose request objects into named, validated input contracts.
- `fluo generate request-dto <feature> <name>` starts a DTO file in the feature slice, but the controller still needs `@RequestDto()`.
- `@RequestDto()` connects HTTP binding with DTO materialization and validation.
- Validation decorators make FluoBlog create and update routes safer.
- `PartialType()` is a useful early pattern for creating update DTOs.
- fluo avoids implicit scalar coercion, which makes input handling predictable.
- The posts service now receives cleaner transport-boundary data.

## Next Chapter Preview
In Chapter 7, we move to the response side of the API. If validation made FluoBlog's input boundary safer, the next step is separating internal data from external response data through output DTOs.
