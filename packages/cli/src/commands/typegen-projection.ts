import type { ReactJsonField, ReactJsonShape, ReactQueryField } from '@fluojs/react/typegen';
import ts from 'typescript';

import type { TypegenCompiler } from './typegen-compiler.js';
import { TypegenCommandError } from './typegen-options.js';

function fail(node: ts.Node, detail: string): never {
  const source = node.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(node.getStart());
  throw new TypegenCommandError(`${source.fileName}:${position.line + 1}:${position.character + 1}: ${detail}`);
}

/**
 * Project only the explicitly supported JSON subset of a resolved compiler type.
 *
 * @param options Compiler snapshot, resolved type and diagnostic location.
 * @returns A runtime-neutral JSON shape with no compiler or server references.
 */
export function projectJsonType(options: {
  readonly snapshot: TypegenCompiler;
  readonly type: ts.Type;
  readonly node: ts.Node;
}): ReactJsonShape {
  const { checker } = options.snapshot;
  const active = new Set<ts.Type>();
  const visit = (type: ts.Type, node: ts.Node): ReactJsonShape => {
    if (type.aliasSymbol !== undefined && type.aliasTypeArguments?.[0] !== undefined
      && type.aliasSymbol === options.snapshot.exportSymbol('@fluojs/http', 'HttpWire', node)) {
      return visit(type.aliasTypeArguments[0], node);
    }
    if (type.flags & ts.TypeFlags.Any) return fail(node, 'any cannot be projected; declare the concrete JSON result.');
    if (type.flags & ts.TypeFlags.Unknown) return { kind: 'json' };
    if (type.flags & ts.TypeFlags.TypeParameter) return fail(node, 'Unresolved generic cannot be projected; instantiate its concrete JSON type.');
    if (type.isStringLiteral() || type.isNumberLiteral()) return { kind: 'literal', value: type.value };
    if (type.flags & ts.TypeFlags.String) return { kind: 'string' };
    if (type.flags & ts.TypeFlags.Number) return { kind: 'number' };
    if (type.flags & ts.TypeFlags.BooleanLiteral) {
      return { kind: 'literal', value: checker.typeToString(type) === 'true' };
    }
    if (type.flags & ts.TypeFlags.Boolean) return { kind: 'boolean' };
    if (type.flags & ts.TypeFlags.Null) return { kind: 'null' };
    if (active.has(type)) return fail(node, 'Recursive JSON shape is unsupported; use a finite plain-data result.');
    active.add(type);
    try {
      if (type.isUnion()) return { kind: 'union', members: type.types.map((member) => visit(member, node)) };
      if (checker.isTupleType(type)) return fail(node, 'Positional tuples are unsupported; declare a homogeneous readonly JSON array.');
      if (checker.isArrayType(type)) {
        const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
        if (element === undefined) return fail(node, 'Array element type is unavailable.');
        return { kind: 'array', item: visit(element, node) };
      }
      if (!(type.flags & ts.TypeFlags.Object) || type.getCallSignatures().length > 0
        || type.getConstructSignatures().length > 0) {
        return fail(node, `Unsupported JSON type ${checker.typeToString(type)}; return plain JSON data.`);
      }
      if (type.getSymbol()?.declarations?.some((declaration) =>
        ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration))) {
        return fail(node, 'Class, Date and custom toJSON values are unsupported; return a plain JSON object.');
      }
      if (checker.getIndexInfosOfType(type).length > 0) {
        return fail(node, 'Open index signatures are unsupported; declare the finite result properties.');
      }
      if (checker.getPropertiesOfType(type).some((property) =>
        checker.getTypeOfSymbolAtLocation(property, node).getCallSignatures().length > 0)) {
        return fail(node, 'Function members, Date and custom toJSON values are unsupported; return a plain JSON object.');
      }
      const fields: Record<string, ReactJsonField> = {};
      for (const property of checker.getPropertiesOfType(type)) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? node;
        const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
        const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
        const concrete = optional && propertyType.isUnion()
          ? propertyType.types.filter((member) => !(member.flags & ts.TypeFlags.Undefined))
          : [propertyType];
        const shapes = concrete.map((member) => visit(member, declaration));
        if (shapes.length === 0) return fail(declaration, 'Undefined-only properties have no JSON representation.');
        Object.defineProperty(fields, property.getName(), {
          enumerable: true,
          value: { optional, shape: shapes.length === 1 ? shapes[0] : { kind: 'union', members: shapes } },
        });
      }
      return { kind: 'object', fields };
    } finally {
      active.delete(type);
    }
  };
  return visit(options.type, options.node);
}

function isWireText(shape: ReactJsonShape): boolean {
  switch (shape.kind) {
    case 'string': return true;
    case 'literal': return typeof shape.value === 'string';
    case 'array': return shape.item.kind !== 'array' && isWireText(shape.item);
    case 'union': return shape.members.every(isWireText);
    default: return false;
  }
}

/**
 * Connect actual HTTP DTO bindings to the instrumented compiler declaration.
 *
 * @param snapshot Frozen compiler/object association for this generation.
 * @param projection HTTP-owned binding metadata containing the actual DTO constructor.
 * @param source The existing query or URL-encoded body binding being projected.
 * @returns Typed query fields with authoritative aliases and optional materialization.
 */
export function projectHttpQuery(snapshot: TypegenCompiler, projection: unknown, source: 'query' | 'body' = 'query'): readonly ReactQueryField[] {
  if (typeof projection !== 'object' || projection === null || !('fields' in projection) || !Array.isArray(projection.fields)) {
    throw new TypegenCommandError('HTTP tooling returned malformed binding projection.');
  }
  if (!('input' in projection) || projection.input === undefined) return [];
  if (typeof projection.input !== 'function') throw new TypegenCommandError('HTTP input is not a constructor.');
  const declaration = snapshot.declaration(projection.input);
  const checker = snapshot.checker;
  const dtoType = snapshot.instanceType(projection.input);
  const fields: ReactQueryField[] = [];
  for (const binding of projection.fields) {
    if (typeof binding !== 'object' || binding === null || !('source' in binding)) {
      return fail(declaration.node, 'Malformed HTTP field binding.');
    }
    if (binding.source !== source) continue;
    if (!('property' in binding) || typeof binding.property !== 'string' || !('wire' in binding) || typeof binding.wire !== 'string'
      || !('optional' in binding) || typeof binding.optional !== 'boolean' || !('converted' in binding) || typeof binding.converted !== 'boolean') {
      return fail(declaration.node, 'Unsupported query binding; use a named string property.');
    }
    const property = checker.getPropertyOfType(dtoType, binding.property);
    if (property === undefined) return fail(declaration.node, `HTTP property ${binding.property} is unavailable in the frozen compiler source.`);
    const node = property.valueDeclaration ?? property.declarations?.[0] ?? declaration.node;
    const type = checker.getTypeOfSymbolAtLocation(property, node);
    const wire = snapshot.exportSymbol('@fluojs/http', 'HttpWire', node);
    const canonicalMarker = wire === undefined ? undefined : checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(wire))
      .find((member) => member.declarations?.some((candidate) => ts.isPropertySignature(candidate) && ts.isComputedPropertyName(candidate.name)));
    const concreteTypes = type.isUnion()
      ? type.types.filter((member) => !(member.flags & ts.TypeFlags.Undefined))
      : [type];
    const candidates = concreteTypes.flatMap((concreteType) => {
      const wireMarker = canonicalMarker === undefined ? undefined : checker.getPropertiesOfType(concreteType).find((member) =>
        member.declarations?.some((candidate) => canonicalMarker.declarations?.includes(candidate)));
      if (binding.converted && wireMarker === undefined) {
        return fail(node, `Converted query ${binding.property} requires HttpWire<Server, Wire>; declare pre-conversion text explicitly.`);
      }
      const wireType = wireMarker === undefined ? concreteType : checker.getTypeOfSymbolAtLocation(wireMarker, node);
      return wireType.isUnion()
        ? wireType.types.filter((member) => !(member.flags & ts.TypeFlags.Undefined))
        : [wireType];
    });
    const shapes = candidates.map((member) => projectJsonType({ snapshot, type: member, node }));
    const shape: ReactJsonShape = shapes.length === 1 ? shapes[0] : { kind: 'union', members: shapes };
    if (!isWireText(shape)) return fail(node, `Query ${binding.property} is not HTTP wire text; use HttpWire<Server, string> for converters.`);
    fields.push({ property: binding.property, wire: binding.wire, optional: binding.optional, shape });
  }
  return fields;
}

/**
 * Project a compiled handler's module props or saved-data result from actual object identity.
 *
 * @param snapshot Frozen compiler graph and instrumented constructors.
 * @param descriptor Actual HTTP compiled descriptor.
 * @param page Whether HTTP has compiled a marked React page requiring concrete destination inference.
 * @returns Browser module schemas and optional saved-data schema, never server implementations.
 */
export function projectHandlerResult(snapshot: TypegenCompiler, descriptor: unknown, page = false): {
  readonly modules: Readonly<Record<string, ReactJsonShape>>;
  readonly form?: { readonly data?: ReactJsonShape; readonly dataOptional?: true };
} {
  if (typeof descriptor !== 'object' || descriptor === null || !('controllerToken' in descriptor)
    || typeof descriptor.controllerToken !== 'function' || !('methodName' in descriptor) || typeof descriptor.methodName !== 'string') {
    throw new TypegenCommandError('Malformed compiled handler identity.');
  }
  const { checker } = snapshot;
  const declaration = snapshot.declaration(descriptor.controllerToken);
  const member = checker.getPropertyOfType(snapshot.instanceType(descriptor.controllerToken), descriptor.methodName);
  if (member === undefined) return fail(declaration.node, `Compiled member ${descriptor.methodName} is unavailable in frozen source.`);
  const node = member.valueDeclaration ?? member.declarations?.[0] ?? declaration.node;
  const signature = checker.getTypeOfSymbolAtLocation(member, node).getCallSignatures()[0];
  if (signature === undefined) return fail(node, 'Compiled handler has no callable compiler signature.');
  const result = checker.getAwaitedType(signature.getReturnType()) ?? signature.getReturnType();
  if (page && (result.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter))) {
    return fail(node, 'React page result is erased; preserve the concrete factory result instead of returning any, unknown or an unresolved generic.');
  }
  const modules: Record<string, ReactJsonShape> = {};
  const dataShapes: ReactJsonShape[] = [];
  let form = false;
  let dataOptional = false;
  for (const variant of result.isUnion() ? result.types : [result]) {
    const destination = checker.getPropertyOfType(variant, 'destination');
    if (destination === undefined) continue;
    const destinationType = checker.getTypeOfSymbolAtLocation(destination, node);
    const module = checker.getPropertyOfType(destinationType, 'module');
    const props = checker.getPropertyOfType(destinationType, 'props');
    if (module !== undefined && props !== undefined) {
      const moduleType = checker.getTypeOfSymbolAtLocation(module, node);
      const actualProps = checker.getTypeOfSymbolAtLocation(props, node);
      projectJsonType({ snapshot, type: actualProps, node });
      for (const identity of moduleType.isUnion() ? moduleType.types : [moduleType]) {
        if (!identity.isStringLiteral()) return fail(node, 'Browser module identity is erased; preserve the literal ReactNavigationPage.create result through the factory.');
        const path = ts.resolveModuleName(identity.value, node.getSourceFile().fileName, snapshot.options, ts.sys).resolvedModule?.resolvedFileName;
        const source = path === undefined ? undefined : snapshot.sources.get(path);
        if (source === undefined) return fail(node, `Browser module ${identity.value} is not in the frozen tsconfig graph; use its build-mapped module literal.`);
        const namespace = checker.getSymbolAtLocation(source);
        const component = namespace === undefined ? undefined : checker.getExportsOfModule(namespace).find((symbol) => symbol.getName() === 'default');
        if (component === undefined) return fail(node, `Browser module ${identity.value} has no default component export.`);
        const componentType = checker.getTypeOfSymbolAtLocation(component, source);
        const componentSignature = componentType.getCallSignatures()[0];
        if (componentSignature === undefined) return fail(node, `Browser module ${identity.value} must export a function component with JSON props.`);
        const parameter = componentSignature.getParameters()[0];
        if (parameter === undefined) {
          if (checker.getPropertiesOfType(actualProps).length !== 0) return fail(node, `Browser module ${identity.value} accepts no props.`);
          modules[identity.value] = { kind: 'object', fields: {} };
          continue;
        }
        const expected = checker.getTypeOfSymbolAtLocation(parameter, parameter.valueDeclaration ?? source);
        if (!checker.isTypeAssignableTo(actualProps, expected)) return fail(node, `Handler props do not match ${identity.value}; pass the authored component's JSON props.`);
        const shape = projectJsonType({ snapshot, type: expected, node: parameter.valueDeclaration ?? source });
        if (shape.kind !== 'object' && !(shape.kind === 'union' && shape.members.every((member) => member.kind === 'object'))) {
          return fail(node, `Browser module ${identity.value} requires finite JSON-object props.`);
        }
        const previous = modules[identity.value];
        if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(shape)) {
          return fail(node, `Ambiguous props contract for module ${identity.value}.`);
        }
        modules[identity.value] = shape;
      }
    } else if (checker.getPropertyOfType(variant, 'followUp') !== undefined) {
      form = true;
      const data = checker.getPropertyOfType(variant, 'data');
      if (data === undefined) { dataOptional = true; continue; }
      const dataType = checker.getTypeOfSymbolAtLocation(data, node);
      for (const member of dataType.isUnion() ? dataType.types : [dataType]) {
        if (member.flags & ts.TypeFlags.Undefined) dataOptional = true;
        else dataShapes.push(projectJsonType({ snapshot, type: member, node }));
      }
    }
  }
  return { modules, ...(!form ? {} : { form: {
    ...(dataShapes.length === 0 ? {} : { data: dataShapes.length === 1 ? dataShapes[0] : { kind: 'union' as const, members: dataShapes } }),
    ...(dataOptional && dataShapes.length > 0 ? { dataOptional: true as const } : {}),
  } }) };
}
