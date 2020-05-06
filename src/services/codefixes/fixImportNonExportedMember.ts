/* @internal */
namespace ts.codefix {
    const fixId = "importNonExportedMember";
    const errorCodes = [
        Diagnostics.Module_0_declares_1_locally_but_it_is_not_exported.code
    ];
    registerCodeFix({
        errorCodes,
        getCodeActions(context) {
            const { sourceFile } = context;
            const info = getInfo(sourceFile, context, context.span.start);
            if (!info || info.originSourceFile.isDeclarationFile) {
                return undefined;
            }
            const changes = textChanges.ChangeTracker.with(context, t => doChange(t, info.originSourceFile, info.node));
            return [createCodeFixAction(fixId, changes, [Diagnostics.Export_0_from_module_1, info.node.text, showModuleSpecifier(info.importDecl)], fixId, Diagnostics.Export_all_non_exported_member)];
        },
        fixIds: [fixId],
        getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
            const info = getInfo(diag.file, context, diag.start);
            if (info) doChange(changes, info.originSourceFile, info.node);
        }),
    });

    interface Info {
        readonly node: Identifier;
        readonly importDecl: ImportDeclaration;
        readonly originSourceFile: SourceFile
    }

    function getInfo(sourceFile: SourceFile, context: CodeFixContext | CodeFixAllContext, pos: number): Info | undefined {
        const node = getTokenAtPosition(sourceFile, pos);
        if (node && isIdentifier(node)) {
            const importDecl = findAncestor(node, isImportDeclaration);
            if (!importDecl || !isStringLiteralLike(importDecl.moduleSpecifier)) {
                return undefined;
            }
            const resolvedModule = getResolvedModule(sourceFile, importDecl.moduleSpecifier.text);
            const originSourceFile = resolvedModule && context.program.getSourceFile(resolvedModule.resolvedFileName);
            if (!originSourceFile) {
                return undefined;
            }
            return { node, importDecl, originSourceFile };
        }
    }

    function isImportDeclaration(node: Node): node is ImportDeclaration {
        return node.kind === SyntaxKind.ImportDeclaration;
    }

    function getNamedExportDeclaration(moduleSymbol: Symbol): ExportDeclaration | undefined {
        let namedExport;
        moduleSymbol.exports?.forEach((symbol) => {
            const specifier = symbol.declarations[0];
            if(specifier && isExportSpecifier(specifier) && isNamedExports(specifier.parent)) {
                namedExport = specifier.parent?.parent;
            }
        });
        return namedExport;
    }

    function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, node: Identifier): void {
        const moduleSymbol = sourceFile.localSymbol || sourceFile.symbol;
        const localSymbol = moduleSymbol.valueDeclaration.locals?.get(node.escapedText);
        if(!localSymbol) {
            return;
        }
        if(isFunctionSymbol(localSymbol)) {
            const start = localSymbol.valueDeclaration.pos;
            changes.insertExportModifierAtPos(sourceFile, start? start+1:0);
            return;
        }

        const current: VariableDeclarationList | Node = localSymbol.valueDeclaration.parent;
        if(isVariableDeclarationList(current) && current.declarations.length <= 1) {
            const start = localSymbol.valueDeclaration.parent.pos;
            changes.insertExportModifierAtPos(sourceFile, start ? start + 1 : 0);
            return;
        }

        const namedExportDeclaration = getNamedExportDeclaration(moduleSymbol);
        let exportDeclaration;
        const exportSpecifier = createExportSpecifier(/*propertyName*/ undefined, node);
        if(namedExportDeclaration?.exportClause && isNamedExports(namedExportDeclaration.exportClause)) {
            exportDeclaration = updateExportDeclaration(
                namedExportDeclaration,
                /*decorators*/ undefined,
                /*modifiers*/ undefined,
                updateNamedExports(namedExportDeclaration.exportClause, namedExportDeclaration.exportClause.elements.concat(exportSpecifier)),
                /*moduleSpecifier*/ undefined,
                /*isTypeOnly*/ false);
            changes.replaceNode(sourceFile, namedExportDeclaration, exportDeclaration);
            return;
        }
        exportDeclaration = createExportDeclaration(
            /*decorators*/ undefined,
            /*modifiers*/ undefined,
            createNamedExports([exportSpecifier]),
            /*moduleSpecifier*/ undefined,
            /*isTypeOnly*/ false);
        changes.insertNodeAtEndOfScope(sourceFile, sourceFile, exportDeclaration);
    }
}
