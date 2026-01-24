/**
 * Override types for npm-packlist v10+
 * npm-packlist v10 requires a tree-like arborist node object
 */
declare module 'npm-packlist' {
  interface PackageJson {
    name?: string;
    version?: string;
    files?: string[];
    bin?: string | Record<string, string>;
    browser?: string | Record<string, string>;
    main?: string;
    bundleDependencies?: string[];
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    [key: string]: unknown;
  }

  interface PacklistTree {
    /** Absolute path to the package directory */
    path: string;
    /** Package.json content */
    package: PackageJson;
    /** Must be true for root packages to use bundleDependencies instead of all deps */
    isProjectRoot?: boolean;
    /** Map of dependency edges (only needed if bundleDependencies is non-empty) */
    edgesOut?: Map<string, unknown>;
  }

  interface PacklistOptions {
    tree?: PacklistTree;
  }

  function packlist(tree: PacklistTree, options?: PacklistOptions): Promise<string[]>;
  export = packlist;
}
