#![deny(clippy::all)]
#![allow(clippy::large_enum_variant)]
#![allow(clippy::upper_case_acronyms)]

use std::sync::Arc;
use std::io::stderr;
use std::panic::AssertUnwindSafe;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

use swc::Compiler;
use swc_common::{
    errors::Handler,
    FileName,
    FilePathMapping,
    SourceMap,
    GLOBALS,
};
use swc_ecma_ast::{EsVersion};
use swc_ecma_parser::Syntax;
use swc_estree_compat::babelify::{Babelify, Context};

/// Options to control the parsing and babelify process.
#[napi(object)]
#[derive(Default, Debug, Deserialize, Serialize)]
pub struct BabelifyOptions {
    /// The file name to associate with the source (for error reporting)
    pub file_name: Option<String>,
    /// The syntax to use: "typescript" (default) or "ecmascript"
    pub syntax: Option<String>,
    /// Whether to treat the source as a module (default true)
    pub is_module: Option<bool>,
    /// ECMAScript version: "es3", "es5" (default), "es2015", "es2016", etc.
    pub es_version: Option<String>,
}

/// Parse a JavaScript/TypeScript source and transform it into a Babel-compatible AST.
///
/// This function exposes the same pipeline as in your bench test. It creates a new SWC compiler,
/// parses the source using the provided options, and then runs the Babelify conversion.
///
/// # Parameters
/// - `source`: The source code to parse.
/// - `options`: An optional object to override default parameters (file name, syntax, module mode, and ECMAScript version).
///
/// # Returns
/// A JSON string representing the Babelified AST.
///
/// # Example (in JavaScript)
/// ```js
/// const { parseAndBabelify } = require("your-native-addon");
/// const source = "let a = 1;";
/// const opts = { file_name: "example.js", syntax: "typescript", is_module: true, es_version: "es5" };
/// const astJson = parseAndBabelify(source, opts);
/// console.log(astJson);
/// ```
#[napi]
pub fn parse_and_babelify(source: String, options: Option<BabelifyOptions>) -> Result<serde_json::Value> {
    // Apply defaults if options are not provided.
    let opts = options.unwrap_or_default();
    let file_name = opts.file_name.unwrap_or_else(|| "input.js".to_string());
    let syntax = match opts.syntax.as_deref() {
        Some("ecmascript") => Syntax::Es(Default::default()),
        _ => Syntax::Typescript(Default::default()),
    };
    let is_module = opts.is_module.unwrap_or(true);
    let es_version = match opts.es_version.as_deref() {
        Some("es3") => EsVersion::Es3,
        Some("es5") => EsVersion::Es5,
        Some("es2015") => EsVersion::Es2015,
        Some("es2016") => EsVersion::Es2016,
        Some("es2017") => EsVersion::Es2017,
        Some("es2018") => EsVersion::Es2018,
        Some("es2019") => EsVersion::Es2019,
        Some("es2020") => EsVersion::Es2020,
        _ => EsVersion::Es5,
    };

    GLOBALS.set(&Default::default(), || {
        // Create a SourceMap and a new Compiler.
        let cm = Arc::new(SourceMap::new(FilePathMapping::empty()));
        let compiler = Compiler::new(cm.clone());

        // Create a new source file from the input.
        let fm = cm.new_source_file(
            FileName::Real(file_name.into()).into(),
            source,
        );

        // Create an error handler and get the comments.
        let handler = Handler::with_emitter_writer(Box::new(stderr()), Some(cm.clone()));
        let comments = compiler.comments().clone();

        // Parse the source code into an SWC AST.
        let program = compiler.parse_js(
            fm.clone(),
            &handler,
            es_version,
            syntax,
            swc::config::IsModule::Bool(is_module),
            Some(&comments),
        )
        .map_err(|err| Error::from_reason(format!("Parse error: {:?}", err)))?;

        // In your bench test you sometimes applied additional transforms (resolver, typescript stripping, es2020)
        // before babelifying. Here you can add those transforms if desired. For simplicity, we use the parsed program directly.
        let ctx = Context {
            fm: fm.clone(),
            cm: cm.clone(),
            comments: comments.clone(),
        };

        let babel_ast_result = std::panic::catch_unwind(AssertUnwindSafe(|| program.babelify(&ctx)));
        let babel_ast = match babel_ast_result {
            Ok(ast) => ast,
            Err(_) => {
                return Err(napi::Error::from_reason(
                    "Conversion failed due to unsupported optional chaining.",
                ))
            }
        };

        // Serialize the resulting AST to JSON.
        serde_json::to_value(&babel_ast)
            .map_err(|err| Error::from_reason(format!("Serialization error: {:?}", err)))
    })
}
