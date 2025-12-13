#!/usr/bin/env bun
import { $ } from "bun";

/* WebAssembly type system */
type WasmNumType = "i32" | "i64" | "f32" | "f64";
type WasmVecType = "v128";
type WasmValType = WasmNumType | WasmVecType;
type WasmReturnType = WasmValType | "nil";

interface WasmType {
	params: WasmValType[];
	returns: WasmReturnType;
}

interface WasmImport {
	name: string;
	module: string;
	funcIndex: number;
	signature: WasmType;
}

interface WasmExport {
	name: string;
	funcIndex: number;
	signature: WasmType;
}

interface BindingsData {
	version: string;
	types: Array<{
		index: number;
		params: WasmValType[];
		returns: WasmReturnType;
	}>;
	imports: Array<{
		name: string;
		module: string;
		funcIndex: number;
		params: WasmValType[];
		returns: WasmReturnType;
	}>;
	exports: Array<{
		name: string;
		funcIndex: number;
		wasmSignature: {
			params: WasmValType[];
			returns: WasmReturnType;
		};
		cReturnType: string;
		cParams: Array<{
			name: string;
			cType: string;
			doc: string;
		}>;
		summary: string;
		returnDoc: string;
	}>;
}

/* WASM parsing */

function parseWasmTypes(objdumpOutput: string): Map<number, WasmType> {
	const types = new Map<number, WasmType>();
	const typeRegex = /type\[(\d+)\]\s+\(([^)]*)\)\s+->\s+(.+)/g;

	for (const match of objdumpOutput.matchAll(typeRegex)) {
		const typeIdx = parseInt(match[1], 10);
		const paramsStr = match[2].trim();
		const params = paramsStr
			? paramsStr.split(",").map((p) => p.trim() as WasmValType)
			: [];
		const returns = match[3].trim() as WasmReturnType;

		types.set(typeIdx, { params, returns });
	}

	return types;
}

function parseFunctionSignatures(objdumpOutput: string): Map<number, number> {
	const funcSignatures = new Map<number, number>();
	const funcRegex = /func\[(\d+)\]\s+sig=(\d+)/g;

	for (const match of objdumpOutput.matchAll(funcRegex)) {
		const funcIdx = parseInt(match[1], 10);
		const sigIdx = parseInt(match[2], 10);
		funcSignatures.set(funcIdx, sigIdx);
	}

	return funcSignatures;
}

function parseWasmImports(
	objdumpOutput: string,
	types: Map<number, WasmType>,
): WasmImport[] {
	const imports: WasmImport[] = [];
	const importRegex =
		/func\[(\d+)\]\s+sig=(\d+)\s+<([^>]+)>\s+<-\s+([^\s]+)\.([^\s]+)/g;

	for (const match of objdumpOutput.matchAll(importRegex)) {
		const funcIdx = parseInt(match[1], 10);
		const sigIdx = parseInt(match[2], 10);
		const name = match[3];
		const module = match[4];

		const signature = types.get(sigIdx);
		if (signature) {
			imports.push({
				name,
				module,
				funcIndex: funcIdx,
				signature,
			});
		}
	}

	return imports;
}

function parseWasmExports(
	objdumpOutput: string,
	types: Map<number, WasmType>,
	funcSignatures: Map<number, number>,
): WasmExport[] {
	const exports: WasmExport[] = [];
	const exportRegex = /func\[(\d+)\]\s+(?:<[^>]+>\s+)?->\s+"([^"]+)"/g;

	for (const match of objdumpOutput.matchAll(exportRegex)) {
		const funcIdx = parseInt(match[1], 10);
		const name = match[2];

		if (name === "malloc" || name === "free") {
			continue;
		}

		const sigIdx = funcSignatures.get(funcIdx);
		if (sigIdx !== undefined) {
			const signature = types.get(sigIdx);
			if (signature) {
				exports.push({
					name,
					funcIndex: funcIdx,
					signature,
				});
			}
		}
	}

	return exports;
}

/* C header parsing */

interface HeaderFunctionInfo {
	name: string;
	summary: string;
	cReturnType: string;
	paramTypes: Map<string, string>;
	paramDocs: Map<string, string>;
	returnDoc: string;
}

function extractDocs(docLines: string[]): {
	summary: string;
	paramDocs: Map<string, string>;
	returnDoc: string;
} {
	let summary = "";
	let returnDoc = "";
	const paramDocs = new Map<string, string>();

	for (const line of docLines) {
		if (line.includes("//!")) {
			const comment = line.substring(line.indexOf("//!") + 3).trim();

			if (comment.startsWith("@param ")) {
				const paramMatch = comment.match(/@param\s+(\w+)\s+(.+)/);
				if (paramMatch) {
					paramDocs.set(paramMatch[1], paramMatch[2]);
				}
			} else if (comment.startsWith("@return ")) {
				returnDoc = comment.substring("@return ".length).trim();
			} else if (comment && !comment.startsWith("@") && !summary) {
				summary = comment;
			}
		}
	}

	return { summary, paramDocs, returnDoc };
}

function parseHeaderFunction(
	lines: string[],
	exportLineIndex: number,
): HeaderFunctionInfo | null {
	const exportLine = lines[exportLineIndex];

	const exportMatch = exportLine.match(/HAKO_EXPORT\("([^"]+)"\)/);
	if (!exportMatch) return null;
	const name = exportMatch[1];

	const fullRegex =
		/HAKO_EXPORT\("[^"]+"\)\s+extern\s+([\w\s*]+?)\s+(\w+)\s*\(([^)]*)\);/;
	const match = exportLine.match(fullRegex);
	if (!match) return null;

	const cReturnType = match[1].trim();
	const paramsStr = match[3];

	const paramTypes = new Map<string, string>();
	if (paramsStr && paramsStr !== "void") {
		const paramRegex = /((?:const\s+)?[\w]+\**)\s+(\w+)/g;
		for (const paramMatch of paramsStr.matchAll(paramRegex)) {
			const type = paramMatch[1].trim();
			const paramName = paramMatch[2];
			paramTypes.set(paramName, type);
		}
	}

	const docLines: string[] = [];
	for (let i = exportLineIndex - 1; i >= 0; i--) {
		const line = lines[i];
		if (line.trim() === "" || !line.includes("//!")) break;
		docLines.unshift(line);
	}

	const { summary, paramDocs, returnDoc } = extractDocs(docLines);

	return { name, summary, cReturnType, paramTypes, paramDocs, returnDoc };
}

function parseHeader(headerContent: string): Map<string, HeaderFunctionInfo> {
	const functions = new Map<string, HeaderFunctionInfo>();
	const lines = headerContent.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.includes("HAKO_EXPORT(")) {
			const parsed = parseHeaderFunction(lines, i);
			if (parsed) {
				functions.set(parsed.name, parsed);
			}
		}
	}

	return functions;
}

/* Data merging */

function createBindingsData(
	version: string,
	types: Map<number, WasmType>,
	imports: WasmImport[],
	exports: WasmExport[],
	headerFunctions: Map<string, HeaderFunctionInfo>,
): BindingsData {
	const exportData = exports.map((exp) => {
		const headerInfo = headerFunctions.get(exp.name);

		if (!headerInfo) {
			return {
				name: exp.name,
				funcIndex: exp.funcIndex,
				wasmSignature: {
					params: exp.signature.params,
					returns: exp.signature.returns,
				},
				cReturnType: "unknown",
				cParams: [],
				summary: "",
				returnDoc: "",
			};
		}

		const cParams: Array<{ name: string; cType: string; doc: string }> = [];
		for (const [paramName, cType] of headerInfo.paramTypes) {
			const doc = headerInfo.paramDocs.get(paramName) || "";
			cParams.push({ name: paramName, cType, doc });
		}

		return {
			name: exp.name,
			funcIndex: exp.funcIndex,
			wasmSignature: {
				params: exp.signature.params,
				returns: exp.signature.returns,
			},
			cReturnType: headerInfo.cReturnType,
			cParams,
			summary: headerInfo.summary,
			returnDoc: headerInfo.returnDoc,
		};
	});

	return {
		version,
		types: Array.from(types.entries()).map(([index, sig]) => ({
			index,
			params: sig.params,
			returns: sig.returns,
		})),
		imports: imports.map((imp) => ({
			name: imp.name,
			module: imp.module,
			funcIndex: imp.funcIndex,
			params: imp.signature.params,
			returns: imp.signature.returns,
		})),
		exports: exportData,
	};
}

/* C# code generation */

type CSharpType = string;

const CSharpGenerator = {
	wasmTypeToCSharp(wasmType: WasmValType | WasmReturnType): CSharpType {
		const map: Record<WasmValType | WasmReturnType, CSharpType> = {
			i32: "int",
			i64: "long",
			f32: "float",
			f64: "double",
			v128: "V128",
			nil: "void",
		};
		return map[wasmType] || "int";
	},

	cTypeToCSharp(cType: string, paramName: string): CSharpType {
		if (cType === "JSRuntime*") return "JSRuntimePointer";
		if (cType === "JSContext*") return "JSContextPointer";
		if (cType === "JSValue*" || cType === "JSValueConst*")
			return "JSValuePointer";
		if (cType === "JSModuleDef*") return "JSModuleDefPointer";
		if (cType === "JSClassID") return "JSClassID";

		if (cType === "void*") {
			if (
				paramName === "buffer" ||
				paramName.includes("buf") ||
				paramName === "ptr"
			) {
				return "JSMemoryPointer";
			}
			return "int";
		}

		if (cType === "double") return "double";
		if (cType === "float") return "float";
		if (cType === "int64_t") return "long";
		if (cType === "uint64_t") return "ulong";
		if (cType === "int32_t" || cType === "int") return "int";
		if (cType === "uint32_t" || cType === "unsigned int") return "uint";
		if (cType === "size_t") return "int";
		if (cType === "JS_BOOL") return "int";
		if (cType === "char*" || cType === "const char*") return "int";

		if (cType.includes("*")) return "int";

		return "int";
	},

	getCSharpReturnType(
		wasmReturnType: WasmReturnType,
		cReturnType: string,
	): CSharpType {
		if (wasmReturnType === "nil" || cReturnType === "void") return "void";

		if (cReturnType === "double") return "double";
		if (cReturnType === "float") return "float";
		if (cReturnType === "int64_t") return "long";
		if (cReturnType === "uint64_t") return "ulong";

		if (cReturnType === "JSRuntime*") return "JSRuntimePointer";
		if (cReturnType === "JSContext*") return "JSContextPointer";
		if (cReturnType === "JSValue*" || cReturnType === "JSValueConst*")
			return "JSValuePointer";
		if (cReturnType === "JSModuleDef*") return "JSModuleDefPointer";
		if (cReturnType === "JSClassID") return "JSClassID";

		if (cReturnType.includes("*")) return "int";

		return "int";
	},

	toMethodName(hakoName: string): string {
		return hakoName.replace(/^HAKO_/, "");
	},

	toFieldName(hakoName: string): string {
		const name = hakoName.replace(/^HAKO_/, "");
		return `_${name.charAt(0).toLowerCase()}${name.slice(1)}`;
	},

	toCamelCase(name: string): string {
		return name.charAt(0).toLowerCase() + name.slice(1);
	},

	generateAutoGenHeader(version: string): string {
		return `//------------------------------------------------------------------------------
// <auto-generated>
//     This code was generated by a tool.
//     Hako Version: ${version}
//
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.
// </auto-generated>
//------------------------------------------------------------------------------

`;
	},

	generateFileHeader(): string {
		return `

#nullable enable

using HakoJS.Backend.Core;

namespace HakoJS.Host;

internal sealed class HakoRegistry
{
    public const int NullPointer = 0;
    private readonly WasmInstance _instance;

    internal HakoRegistry(WasmInstance instance)
    {
        _instance = instance ?? throw new ArgumentNullException(nameof(instance));
        InitializeFunctions();
    }
`;
	},

	getHelperMethodCall(exp: BindingsData["exports"][0]): string {
		const returnType = this.wasmTypeToCSharp(exp.wasmSignature.returns);
		const paramTypes = exp.wasmSignature.params.map((p) =>
			this.wasmTypeToCSharp(p),
		);
		const paramCount = paramTypes.length;

		const hasDouble = paramTypes.includes("double");
		const hasLong = paramTypes.includes("long");

		if (returnType === "void") {
			// Action
			if (hasLong) {
				const typeParams = paramCount > 0 ? `<${paramTypes.join(", ")}>` : "";
				return `TryCreateActionWithLong${typeParams}("${exp.name}")`;
			} else {
				const typeParams = paramCount > 0 ? `<${paramTypes.join(", ")}>` : "";
				return `TryCreateAction${typeParams}("${exp.name}")`;
			}
		} else {
			// Func
			const suffix =
				returnType === "long"
					? "Int64"
					: returnType === "double"
						? "Double"
						: returnType === "float"
							? "Float"
							: "Int32";

			if (hasDouble) {
				const typeParams = paramCount > 0 ? `<${paramTypes.join(", ")}>` : "";
				return `TryCreateFunc${suffix}WithDouble${typeParams}("${exp.name}")`;
			} else if (hasLong) {
				const typeParams = paramCount > 0 ? `<${paramTypes.join(", ")}>` : "";
				return `TryCreateFunc${suffix}WithLong${typeParams}("${exp.name}")`;
			} else {
				const typeParams = paramCount > 0 ? `<${paramTypes.join(", ")}>` : "";
				return `TryCreateFunc${suffix}${typeParams}("${exp.name}")`;
			}
		}
	},

	generateInitializeMethod(bindings: BindingsData): string {
		const lines: string[] = ["    private void InitializeFunctions()", "    {"];

		for (const exp of bindings.exports) {
			const fieldName = this.toFieldName(exp.name);
			const helperCall = this.getHelperMethodCall(exp);
			lines.push(`        ${fieldName} = ${helperCall};`);
		}

		lines.push("    }\n");
		return lines.join("\n");
	},

	getCSharpFieldType(exp: BindingsData["exports"][0]): string {
		const returnType = this.wasmTypeToCSharp(exp.wasmSignature.returns);
		const paramTypes = exp.wasmSignature.params.map((p) =>
			this.wasmTypeToCSharp(p),
		);
		const paramCount = paramTypes.length;

		if (returnType === "void") {
			if (paramCount === 0) return "Action";
			return `Action<${paramTypes.join(", ")}>`;
		} else {
			if (paramCount === 0) return `Func<${returnType}>`;
			return `Func<${paramTypes.join(", ")}, ${returnType}>`;
		}
	},

	generateFields(bindings: BindingsData): string {
		const lines: string[] = ["    #region Function Invokers\n"];

		for (const exp of bindings.exports) {
			const fieldType = this.getCSharpFieldType(exp);
			const fieldName = this.toFieldName(exp.name);
			lines.push(`    private ${fieldType}? ${fieldName};`);
		}

		lines.push("\n    #endregion\n");
		return lines.join("\n");
	},

	getHelperSignature(exp: BindingsData["exports"][0]): string {
		const returnType = this.wasmTypeToCSharp(exp.wasmSignature.returns);
		const paramTypes = exp.wasmSignature.params.map((p) =>
			this.wasmTypeToCSharp(p),
		);
		const paramCount = paramTypes.length;
		const hasDouble = paramTypes.includes("double");
		const hasLong = paramTypes.includes("long");
		return `${returnType}|${paramCount}|${hasDouble}|${hasLong}`;
	},

	generateHelperMethod(signature: string): string {
		const [returnType, paramCountStr, hasDoubleStr, hasLongStr] =
			signature.split("|");
		const paramCount = parseInt(paramCountStr, 10);
		const hasDouble = hasDoubleStr === "true";
		const hasLong = hasLongStr === "true";

		const typeParams =
			paramCount > 0
				? `<${Array(paramCount)
						.fill(0)
						.map((_, i) => `T${i + 1}`)
						.join(", ")}>`
				: "";

		if (returnType === "void") {
			// Action
			if (hasLong) {
				const concreteParams = Array(paramCount)
					.fill(0)
					.map((_, i) => (i === paramCount - 1 ? "long" : "int"))
					.join(", ");
				return `private Action<${concreteParams}>? TryCreateActionWithLong${typeParams}(string functionName)
{
    return _instance.GetActionWithLong${typeParams}(functionName);
}
`;
			} else {
				if (paramCount === 0) {
					return `private Action? TryCreateAction(string functionName)
{
    return _instance.GetAction(functionName);
}
`;
				} else {
					const concreteParams = Array(paramCount).fill("int").join(", ");
					return `private Action<${concreteParams}>? TryCreateAction${typeParams}(string functionName)
{
    return _instance.GetAction${typeParams}(functionName);
}
`;
				}
			}
		} else {
			// Func
			const suffix =
				returnType === "long"
					? "Int64"
					: returnType === "double"
						? "Double"
						: returnType === "float"
							? "Float"
							: "Int32";

			if (hasDouble) {
				const concreteParams = Array(paramCount)
					.fill(0)
					.map((_, i) => {
						return i === paramCount - 1 ? "double" : "int";
					})
					.join(", ");

				if (paramCount === 0) {
					return `private Func<${returnType}>? TryCreateFunc${suffix}WithDouble(string functionName)
{
    return _instance.GetFunction${suffix}WithDouble(functionName);
}
`;
				} else {
					return `private Func<${concreteParams}, ${returnType}>? TryCreateFunc${suffix}WithDouble${typeParams}(string functionName)
{
    return _instance.GetFunction${suffix}WithDouble${typeParams}(functionName);
}
`;
				}
			} else if (hasLong) {
				const concreteParams = Array(paramCount)
					.fill(0)
					.map((_, i) => {
						return i === paramCount - 1 ? "long" : "int";
					})
					.join(", ");

				if (paramCount === 0) {
					return `private Func<${returnType}>? TryCreateFunc${suffix}WithLong(string functionName)
{
    return _instance.GetFunction${suffix}WithLong(functionName);
}
`;
				} else {
					return `private Func<${concreteParams}, ${returnType}>? TryCreateFunc${suffix}WithLong${typeParams}(string functionName)
{
    return _instance.GetFunction${suffix}WithLong${typeParams}(functionName);
}
`;
				}
			} else {
				if (paramCount === 0) {
					return `private Func<${returnType}>? TryCreateFunc${suffix}(string functionName)
{
    return _instance.GetFunction${suffix}(functionName);
}
`;
				} else {
					const concreteParams = Array(paramCount).fill("int").join(", ");
					return `private Func<${concreteParams}, ${returnType}>? TryCreateFunc${suffix}${typeParams}(string functionName)
{
    return _instance.GetFunction${suffix}${typeParams}(functionName);
}
`;
				}
			}
		}
	},

	generateHelperMethods(bindings: BindingsData): string {
		const signatures = new Set<string>();
		for (const exp of bindings.exports) {
			signatures.add(this.getHelperSignature(exp));
		}

		const lines: string[] = ["#region Helper Methods for Creating Invokers\n"];
		for (const sig of Array.from(signatures).sort()) {
			lines.push(this.generateHelperMethod(sig));
		}
		lines.push("#endregion\n");

		return lines.join("\n");
	},

	generatePublicMethod(exp: BindingsData["exports"][0]): string {
		const methodName = this.toMethodName(exp.name);
		const fieldName = this.toFieldName(exp.name);
		const params = exp.cParams
			.map(
				(p) =>
					`${this.cTypeToCSharp(p.cType, p.name)} ${this.toCamelCase(p.name)}`,
			)
			.join(", ");

		// Map unsigned types to their signed equivalents for WASM
		const unsignedToSignedMap: Record<string, string> = {
			ulong: "long",
			uint: "int",
			ushort: "short",
			byte: "sbyte",
		};

		const args = exp.cParams
			.map((p) => {
				const csharpType = this.cTypeToCSharp(p.cType, p.name);
				const paramName = this.toCamelCase(p.name);
				const signedType = unsignedToSignedMap[csharpType];

				if (signedType) {
					return `(${signedType})${paramName}`;
				}
				return paramName;
			})
			.join(", ");

		const returnType = this.getCSharpReturnType(
			exp.wasmSignature.returns,
			exp.cReturnType,
		);
		const isVoid = returnType === "void";

		// Cast return value for unsigned types since WASM only returns signed
		const needsReturnCast = returnType in unsignedToSignedMap;
		const returnCast = needsReturnCast ? `(${returnType})` : "";

		const lines: string[] = [];
		lines.push(`    /// <summary>${exp.summary}</summary>`);
		for (const param of exp.cParams) {
			lines.push(
				`    /// <param name="${this.toCamelCase(param.name)}">${param.doc}</param>`,
			);
		}
		if (exp.returnDoc && returnType !== "void") {
			lines.push(`    /// <returns>${exp.returnDoc}</returns>`);
		}
		lines.push(`    public ${returnType} ${methodName}(${params})`);
		lines.push("    {");
		if (isVoid) {
			lines.push("        Hako.Dispatcher.Invoke(() =>");
			lines.push("        {");
			lines.push(`            if (${fieldName} == null)`);
			lines.push(
				`                throw new InvalidOperationException("${exp.name} not available");`,
			);
			lines.push(`            ${fieldName}(${args});`);
			lines.push("        });");
		} else {
			lines.push("        return Hako.Dispatcher.Invoke(() =>");
			lines.push("        {");
			lines.push(`            if (${fieldName} == null)`);
			lines.push(
				`                throw new InvalidOperationException("${exp.name} not available");`,
			);
			lines.push(`            return ${returnCast}${fieldName}(${args});`);
			lines.push("        });");
		}
		lines.push("    }\n");
		return lines.join("\n");
	},

	generatePublicMethods(bindings: BindingsData): string {
		const lines: string[] = ["    #region Public API\n"];

		for (const exp of bindings.exports) {
			lines.push(this.generatePublicMethod(exp));
		}

		lines.push("    #endregion");
		return lines.join("\n");
	},

	generate(bindings: BindingsData): string {
		const parts: string[] = [];

		parts.push(this.generateAutoGenHeader(bindings.version));
		parts.push(this.generateFileHeader());
		parts.push(this.generateInitializeMethod(bindings));
		parts.push(this.generateFields(bindings));
		parts.push(this.generateHelperMethods(bindings));
		parts.push(this.generatePublicMethods(bindings));
		parts.push("}\n");

		return parts.join("\n");
	},
};

/* Go code generation */

type GoType = string;

const GoGenerator = {
	wasmTypeToGo(wasmType: WasmValType | WasmReturnType): GoType {
		const map: Record<WasmValType | WasmReturnType, GoType> = {
			i32: "int32",
			i64: "int64",
			f32: "float32",
			f64: "float64",
			v128: "[16]byte",
			nil: "",
		};
		return map[wasmType] || "int32";
	},

	cTypeToGo(cType: string, paramName: string): GoType {
		if (cType === "JSRuntime*") return "RuntimePtr";
		if (cType === "JSContext*") return "ContextPtr";
		if (cType === "JSValue*" || cType === "JSValueConst*")
			return "ValuePtr";
		if (cType === "JSModuleDef*") return "ModuleDefPtr";
		if (cType === "JSClassID") return "ClassID";

		if (cType === "void*") {
			if (
				paramName === "buffer" ||
				paramName.includes("buf") ||
				paramName === "ptr"
			) {
				return "MemoryPtr";
			}
			return "int32";
		}

		if (cType === "double") return "float64";
		if (cType === "float") return "float32";
		if (cType === "int64_t") return "int64";
		if (cType === "uint64_t") return "uint64";
		if (cType === "int32_t" || cType === "int") return "int32";
		if (cType === "uint32_t" || cType === "unsigned int") return "uint32";
		if (cType === "size_t") return "int32";
		if (cType === "JS_BOOL") return "int32";
		if (cType === "char*" || cType === "const char*") return "int32";

		if (cType.includes("*")) return "int32";

		return "int32";
	},

	getGoReturnType(
		wasmReturnType: WasmReturnType,
		cReturnType: string,
	): GoType {
		if (wasmReturnType === "nil" || cReturnType === "void") return "";

		if (cReturnType === "double") return "float64";
		if (cReturnType === "float") return "float32";
		if (cReturnType === "int64_t") return "int64";
		if (cReturnType === "uint64_t") return "uint64";

		if (cReturnType === "JSRuntime*") return "RuntimePtr";
		if (cReturnType === "JSContext*") return "ContextPtr";
		if (cReturnType === "JSValue*" || cReturnType === "JSValueConst*")
			return "ValuePtr";
		if (cReturnType === "JSModuleDef*") return "ModuleDefPtr";
		if (cReturnType === "JSClassID") return "ClassID";

		if (cReturnType.includes("*")) return "int32";

		return "int32";
	},

	toPublicName(hakoName: string): string {
		// HAKO_FreeRuntime -> FreeRuntime
		return hakoName.replace(/^HAKO_/, "");
	},

	toPrivateName(hakoName: string): string {
		// HAKO_FreeRuntime -> freeRuntime
		// _initialize -> initializeFn (avoid leading underscore and method conflict)
		if (hakoName.startsWith("_")) {
			const base = hakoName.slice(1);
			return base.charAt(0).toLowerCase() + base.slice(1) + "Fn";
		}
		const name = hakoName.replace(/^HAKO_/, "");
		return name.charAt(0).toLowerCase() + name.slice(1);
	},

	toCamelCase(name: string): string {
		const camel = name.charAt(0).toLowerCase() + name.slice(1);
		// Avoid collision with Go reserved words and context parameter
		if (camel === "ctx") return "jsCtx";
		if (camel === "error") return "errVal";
		if (camel === "type") return "typ";
		if (camel === "func") return "fn";
		if (camel === "map") return "mapVal";
		if (camel === "range") return "rangeVal";
		return camel;
	},

	generateAutoGenHeader(version: string): string {
		return `// Code generated by codegen.ts. DO NOT EDIT.
// Hako Version: ${version}

package hako

`;
	},

	generateImports(): string {
		return `import (
	"context"
	"fmt"

	"github.com/tetratelabs/wazero/api"
)

`;
	},

	generateFuncType(exp: BindingsData["exports"][0]): string {
		const paramTypes = exp.wasmSignature.params.map((p) =>
			this.wasmTypeToGo(p),
		);
		const returnType = this.wasmTypeToGo(exp.wasmSignature.returns);

		if (returnType === "") {
			return `func(${paramTypes.join(", ")})`;
		}
		return `func(${paramTypes.join(", ")}) ${returnType}`;
	},

	generateRegistryStruct(bindings: BindingsData): string {
		const lines: string[] = [
			"// Registry provides access to HAKO WASM exports.",
			"type Registry struct {",
			"\tmod api.Module",
		];

		for (const exp of bindings.exports) {
			const fieldName = this.toPrivateName(exp.name);
			lines.push(`\t${fieldName} api.Function`);
		}

		lines.push("}");
		lines.push("");
		return lines.join("\n");
	},

	generateNewRegistry(bindings: BindingsData): string {
		const lines: string[] = [
			"// NewRegistry creates a new Registry from a WASM module.",
			"func NewRegistry(mod api.Module) (*Registry, error) {",
			"\tr := &Registry{mod: mod}",
			"",
		];

		for (const exp of bindings.exports) {
			const fieldName = this.toPrivateName(exp.name);
			lines.push(`\tr.${fieldName} = mod.ExportedFunction("${exp.name}")`);
			lines.push(`\tif r.${fieldName} == nil {`);
			lines.push(
				`\t\treturn nil, fmt.Errorf("missing export: ${exp.name}")`,
			);
			lines.push(`\t}`);
		}

		lines.push("");
		lines.push("\treturn r, nil");
		lines.push("}");
		lines.push("");
		return lines.join("\n");
	},

	generatePublicMethod(exp: BindingsData["exports"][0]): string {
		const methodName = this.toPublicName(exp.name);
		const fieldName = this.toPrivateName(exp.name);
		const returnType = this.getGoReturnType(
			exp.wasmSignature.returns,
			exp.cReturnType,
		);
		const wasmReturnType = this.wasmTypeToGo(exp.wasmSignature.returns);
		const isVoid = returnType === "";

		// Build parameter list with proper types from C header
		const params: string[] = ["ctx context.Context"];
		const callArgs: string[] = [];

		if (exp.cParams.length > 0) {
			for (let i = 0; i < exp.cParams.length; i++) {
				const param = exp.cParams[i];
				const goType = this.cTypeToGo(param.cType, param.name);
				const paramName = this.toCamelCase(param.name);
				params.push(`${paramName} ${goType}`);
				// Just store the param name, encoding will handle the cast
				callArgs.push(paramName);
			}
		} else {
			// No C params info, use raw wasm types
			for (let i = 0; i < exp.wasmSignature.params.length; i++) {
				const wasmType = this.wasmTypeToGo(exp.wasmSignature.params[i]);
				const paramName = `arg${i}`;
				params.push(`${paramName} ${wasmType}`);
				callArgs.push(paramName);
			}
		}

		const lines: string[] = [];

		// Add doc comment
		if (exp.summary) {
			lines.push(`// ${methodName} ${exp.summary.charAt(0).toLowerCase()}${exp.summary.slice(1)}`);
		}

		// Generate method signature
		if (isVoid) {
			lines.push(`func (r *Registry) ${methodName}(${params.join(", ")}) {`);
		} else {
			lines.push(
				`func (r *Registry) ${methodName}(${params.join(", ")}) ${returnType} {`,
			);
		}

		// Generate call
		const callArgsWithApi = callArgs.map((arg) => `api.EncodeI32(int32(${arg}))`);

		// Handle different wasm param types for encoding
		const encodedArgs: string[] = [];
		for (let i = 0; i < exp.wasmSignature.params.length; i++) {
			const wasmType = exp.wasmSignature.params[i];
			const arg = callArgs[i] || `arg${i}`;
			switch (wasmType) {
				case "i32":
					encodedArgs.push(`api.EncodeI32(int32(${arg}))`);
					break;
				case "i64":
					encodedArgs.push(`api.EncodeI64(int64(${arg}))`);
					break;
				case "f32":
					encodedArgs.push(`api.EncodeF32(float32(${arg}))`);
					break;
				case "f64":
					encodedArgs.push(`api.EncodeF64(float64(${arg}))`);
					break;
				default:
					encodedArgs.push(`api.EncodeI32(int32(${arg}))`);
			}
		}

		if (isVoid) {
			if (encodedArgs.length > 0) {
				lines.push(`\tr.${fieldName}.Call(ctx, ${encodedArgs.join(", ")})`);
			} else {
				lines.push(`\tr.${fieldName}.Call(ctx)`);
			}
		} else {
			if (encodedArgs.length > 0) {
				lines.push(
					`\tresults, _ := r.${fieldName}.Call(ctx, ${encodedArgs.join(", ")})`,
				);
			} else {
				lines.push(`\tresults, _ := r.${fieldName}.Call(ctx)`);
			}

			// Decode return value (note: i64 has no Decode function, just cast directly)
			switch (exp.wasmSignature.returns) {
				case "i32":
					lines.push(`\treturn ${returnType}(api.DecodeI32(results[0]))`);
					break;
				case "i64":
					lines.push(`\treturn ${returnType}(results[0])`);
					break;
				case "f32":
					lines.push(`\treturn ${returnType}(api.DecodeF32(results[0]))`);
					break;
				case "f64":
					lines.push(`\treturn ${returnType}(api.DecodeF64(results[0]))`);
					break;
				default:
					lines.push(`\treturn ${returnType}(api.DecodeI32(results[0]))`);
			}
		}

		lines.push("}");
		lines.push("");
		return lines.join("\n");
	},

	generatePublicMethods(bindings: BindingsData): string {
		const lines: string[] = [];
		for (const exp of bindings.exports) {
			lines.push(this.generatePublicMethod(exp));
		}
		return lines.join("\n");
	},

	generate(bindings: BindingsData): string {
		const parts: string[] = [];

		parts.push(this.generateAutoGenHeader(bindings.version));
		parts.push(this.generateImports());
		// Types are defined in vm/types.go, not here
		parts.push(this.generateRegistryStruct(bindings));
		parts.push(this.generateNewRegistry(bindings));
		parts.push(this.generatePublicMethods(bindings));

		return parts.join("\n");
	},
};

/* Main */

async function main() {
	const command = process.argv[2];

	if (command === "parse") {
		const wasmFile = process.argv[3] || "hako.wasm";
		const headerFile = process.argv[4] || "hako.h";
		const jsonFile = process.argv[5] || "hako-bindings.json";

		let version = "unknown";
		try {
			version = (await $`git describe --tags --always --dirty`.text()).trim();
		} catch {}

		console.log("Parse mode");
		console.log(`  WASM: ${wasmFile}`);
		console.log(`  Header: ${headerFile}`);
		console.log(`  Output: ${jsonFile}`);
		console.log(`  Version: ${version}`);

		try {
			const objdumpOutput = await $`wasm-objdump -x ${wasmFile}`.text();
			const types = parseWasmTypes(objdumpOutput);
			const funcSignatures = parseFunctionSignatures(objdumpOutput);
			const imports = parseWasmImports(objdumpOutput, types);
			const exports = parseWasmExports(objdumpOutput, types, funcSignatures);

			console.log(`  Found ${types.size} types`);
			console.log(`  Found ${imports.length} imports`);
			console.log(`  Found ${exports.length} exports`);

			const headerContent = await Bun.file(headerFile).text();
			const headerFunctions = parseHeader(headerContent);

			const bindings = createBindingsData(
				version,
				types,
				imports,
				exports,
				headerFunctions,
			);

			await Bun.write(jsonFile, JSON.stringify(bindings, null, 2));
			console.log(`Generated ${jsonFile}`);
		} catch (error) {
			console.error("Error:", error);
			process.exit(1);
		}
	} else if (command === "generate") {
		const lang = process.argv[3];
		const jsonFile = process.argv[4] || "hako-bindings.json";
		const outputFile = process.argv[5];

		if (lang !== "csharp" && lang !== "go") {
			console.error(`Error: unsupported language '${lang}'`);
			console.error("Supported languages: csharp, go");
			process.exit(1);
		}

		if (!outputFile) {
			console.error("Error: output file required");
			process.exit(1);
		}

		console.log("Generate mode");
		console.log(`  Language: ${lang}`);
		console.log(`  Input: ${jsonFile}`);
		console.log(`  Output: ${outputFile}`);

		try {
			const jsonContent = await Bun.file(jsonFile).text();
			const bindings: BindingsData = JSON.parse(jsonContent);

			let code: string;
			if (lang === "csharp") {
				code = CSharpGenerator.generate(bindings);
			} else {
				code = GoGenerator.generate(bindings);
			}

			await Bun.write(outputFile, code);
			console.log(`Generated ${outputFile}`);
		} catch (error) {
			console.error("Error:", error);
			process.exit(1);
		}
	} else {
		console.log(`Usage:
  Parse WASM and generate JSON:
    codegen.ts parse <wasm-file> <header-file> [json-output]

  Generate code from JSON:
    codegen.ts generate <language> <json-file> <output-file>

Languages supported: csharp, go

Examples:
  codegen.ts parse hako.wasm hako.h bindings.json
  codegen.ts generate csharp bindings.json HakoRegistry.generated.cs
  codegen.ts generate go bindings.json registry.gen.go
`);
		process.exit(1);
	}
}

main();
