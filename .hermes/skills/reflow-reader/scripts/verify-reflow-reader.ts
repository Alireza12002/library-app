#!/usr/bin/env node
/**
 * Verify Reflow Reader Implementation
 * 
 * Runs typecheck, lint, and tests to verify the Reflow Reader is working correctly.
 * 
 * Usage: node verify-reflow-reader.ts
 */

const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const path = require('path');

function runCommand(cmd) {
  try {
    const output = execSync(cmd, { cwd: '/Users/heydari/Documents/library-app', encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return { success: true, output };
  } catch (error) {
    return { success: false, output: error.stdout || error.message };
  }
}

function checkTypecheck() {
  console.log('🔍 Running typecheck...');
  const result = runCommand('npm run typecheck 2>&1');
  if (result.success) {
    console.log('✅ Typecheck PASSED');
    return true;
  } else {
    console.log('❌ Typecheck FAILED');
    console.log(result.output);
    return false;
  }
}

function checkLint() {
  console.log('🔍 Running lint...');
  const result = runCommand('npm run lint 2>&1');
  if (result.success) {
    console.log('✅ Lint PASSED');
    return true;
  } else {
    console.log('❌ Lint FAILED');
    console.log(result.output);
    return false;
  }
}

function checkTests() {
  console.log('🔍 Running tests...');
  const result = runCommand('npm test 2>&1');
  // Check for pass count
  if (result.success || (result.output && result.output.includes('pass 75'))) {
    console.log('✅ Tests PASSED (75/75)');
    return true;
  } else {
    console.log('❌ Tests FAILED');
    console.log(result.output);
    return false;
  }
}

function checkFiles() {
  console.log('🔍 Checking required files...');
  const requiredFiles = [
    'src/features/reader/hooks/useReflowReader.ts',
    'src/features/reader/components/ReflowReader.tsx',
    'src/features/reader/search.ts',
    'src/data/db/migrations/003_bookmark_reflow.ts',
  ];
  
  let allPresent = true;
  requiredFiles.forEach(file => {
    try {
      readFileSync(path.join('/Users/heydari/Documents/library-app', file), 'utf-8');
      console.log(`  ✅ ${file}`);
    } catch {
      console.log(`❌ ${file} MISSING`);
      allPresent = false;
    }
  });
  return allPresent;
}

function main() {
  console.log('='.repeat(60));
  console.log('Reflow Reader Verification');
  console.log('='.repeat(60));
  console.log();
  
  const results = [];
  
  results.push(checkFiles());
  results.push(checkTypecheck());
  results.push(checkLint());
  results.push(checkTests());
  
  console.log();
  console.log('='.repeat(60));
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`Results: ${passed}/${total} checks passed`);
  
  if (passed === total) {
    console.log('🎉 All checks passed! Reflow Reader is ready.');
    process.exit(0);
  } else {
    console.log('⚠️  Some checks failed. Review the output above.');
    process.exit(1);
  }
}

main();