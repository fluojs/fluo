<!-- packages: @fluojs/http, @fluojs/validation -->
<!-- project-state: FluoBlog v1.3 -->

# Chapter 6. Request Data and DTO Validation

## Learning Objectives
- Understand why DTOs are better than loose request objects.
- Use validation decorators to describe safe input for FluoBlog post creation.
- Learn how `@RequestDto()` connects HTTP binding to DTO materialization.
- Apply optional and partial DTO patterns to update operations.
- Understand why fluo avoids implicit scalar coercion.
- Build a cleaner boundary between transport data and service logic.

## Prerequisites
- Completed Chapter 5.
- Working knowledge of the `PostsController` route examples.
- Basic familiarity with TypeScript classes and properties.
- Comfort reading short validation snippets.

## 6.1 Why Loose Input Becomes a Problem Quickly

In Chapter 5, the create route accepted a plain object.

That was fine for introducing routing.

It is not fine as a long-term input strategy.

A plain object does not communicate which fields are required.

It does not explain which values must be strings.

It does not express minimum lengths or optional fields.

Most importantly, it does not protect the service boundary.

DTOs solve this by giving request data a named shape.

Validation decorators then turn that shape into an executable contract.

```typescript
class CreatePostDto {
  title = '';
  body = '';
}
```

Even before adding validation rules, this is already more readable than an anonymous inline object.

The class name tells you what the payload is for.

The properties tell you what the route expects.

### DTOs Are a Boundary Tool

A DTO is not just a TypeScript convenience.

It creates a transport boundary.

Outside the boundary, the client sends unknown input.

Inside the boundary, your service expects trustworthy structure.

Validation is what makes that transition safe.

## 6.2 Defining CreatePostDto with Validation Rules

Now add rules that describe what a valid post creation request means for FluoBlog.

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

This class now does three useful jobs.

It names the request.

It documents the expected fields.

It defines runtime validation rules.

### Why Field Defaults Help Beginners

You will often see DTO fields initialized with simple defaults.

That pattern makes the class easier to materialize and inspect.

It also keeps examples approachable for readers who are still learning class-based validation.

### What These Rules Mean

`title` must be a string and at least three characters long.

`body` must be a string and at least ten characters long.

`published` may be omitted, but if it appears, it must be a boolean.

These are small rules.

Small rules are enough to show the value of the system.

## 6.3 Connecting DTOs to the HTTP Layer

Validation becomes useful when the controller actually asks fluo to materialize the DTO.

That is the job of `@RequestDto()`.

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

With this decorator in place, the HTTP layer does more than pass a raw body through.

It binds request data.

It materializes the DTO instance.

It validates the result before the service sees it.

That sequence is exactly what we want at the transport boundary.

### `materialize()` vs Plain Assignment

The validation package distinguishes between building a typed instance and validating an existing value.

HTTP binding usually needs the first path.

It takes unknown input and turns it into a DTO instance.

That is why the documentation emphasizes `materialize()` for hydration plus validation.

The beginner takeaway is simple.

Incoming payloads should be transformed into a known DTO shape before business logic runs.

## 6.4 Updating FluoBlog Create and Update Flows

Let us make the post service use DTO-driven input.

We will also prepare an update DTO.

```typescript
import { PartialType } from '@fluojs/validation';

export class UpdatePostDto extends PartialType(CreatePostDto) {}
```

This is a great beginner example of mapped DTO helpers.

`PartialType(CreatePostDto)` means every field from the create DTO becomes optional for updates.

That matches the common semantics of patch-style updates.

Now the controller can use both DTOs.

```typescript
import { Controller, FromPath, Patch, Post, RequestDto } from '@fluojs/http';
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
  update(@FromPath('id') id: string, input: UpdatePostDto) {
    return this.postsService.update(id, input);
  }
}
```

This is a meaningful FluoBlog upgrade.

The create route now has explicit rules.

The update route now communicates partial update semantics clearly.

### Why Mapped DTO Helpers Matter

Beginners often duplicate similar DTOs by hand.

That works at first.

It becomes repetitive and error-prone quickly.

Mapped helpers such as `PartialType`, `PickType`, and `OmitType` reduce that duplication while preserving validation metadata.

That preservation is the important part.

The derived DTO is not just shorter.

It stays behaviorally connected to the original rules.

## 6.5 No Implicit Scalar Coercion

One detail from the validation package documentation deserves extra attention.

The validator is intentionally strict.

If the transport gives you `'42'` and the DTO expects `number`, validation does not silently pretend that the string was already a number.

This is a healthy design choice.

Silent coercion can hide bugs.

It can also make input behavior harder to predict.

### What This Means for FluoBlog

Suppose you later add query parameters like `?page=2` or `?limit=10`.

Those values arrive as transport data.

They are not automatically trusted application numbers.

If conversion is needed, you should do it deliberately in the binding or transport layer.

That explicitness keeps validation honest.

### Beginner Rule of Thumb

Do not assume the network sends the type you want.

Describe the type you expect.

Validate it.

Convert only when you can explain where that conversion belongs.

That rule prevents subtle bugs later.

## 6.6 What FluoBlog Looks Like After Validation

The posts feature is now more realistic.

Routing still matters.

But the service is no longer exposed to shapeless input.

That is a big architectural improvement.

```typescript
// src/posts/posts.service.ts
import { Injectable } from '@fluojs/di';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';

@Injectable()
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

The service signatures are now clearer.

Other readers can see that create and update expect validated DTOs.

That clarity makes future refactoring easier.

### Common Beginner Mistakes with Validation

- Keeping inline object types in controller methods after DTOs already exist.
- Adding validation decorators but forgetting `@RequestDto()`.
- Expecting strings from query parameters to become numbers automatically.
- Copying create DTO fields manually into update DTOs instead of using mapped helpers.
- Treating DTO classes as domain models instead of transport-boundary models.

### Why This Chapter Stops Before Error Details

Once validation exists, readers naturally ask what happens on failure.

That is the right question.

We will answer it soon.

But first, the happy-path response shape needs attention too.

Before handling every error path, it helps to decide what successful output should look like.

## Summary
- DTOs replace loose request objects with named, validated input contracts.
- `@RequestDto()` connects HTTP binding to DTO materialization and validation.
- Validation decorators make FluoBlog create and update routes safer.
- `PartialType()` is a useful beginner pattern for update DTOs.
- fluo intentionally avoids implicit scalar coercion, which keeps input handling predictable.
- The posts service now receives cleaner transport-boundary data.

## Next Chapter Preview
In Chapter 7, we will move to the response side of the API. FluoBlog will start shaping output DTOs so internal data and transport-facing data do not have to be the same thing.
