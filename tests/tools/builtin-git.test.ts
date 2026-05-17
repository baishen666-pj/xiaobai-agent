import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gitTool } from '../../src/tools/builtin-git.js';
import type { ToolResult } from '../../src/tools/registry.js';

let mockExecFileOverride: ((...args: any[]) => any) | null = null;

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return {
    ...orig,
    execFile: (...args: any[]) => {
      if (mockExecFileOverride) return mockExecFileOverride(...args);
      return orig.execFile(...args);
    },
  };
});

beforeEach(() => {
  mockExecFileOverride = null;
});

afterEach(() => {
  mockExecFileOverride = null;
});

function mockGitSuccess(stdout: string): void {
  mockExecFileOverride = (_cmd: string, _args: string[], _opts: any, callback: Function) => {
    callback(null, stdout, '');
  };
}

function mockGitError(stderr: string, code?: string): void {
  mockExecFileOverride = (_cmd: string, _args: string[], _opts: any, callback: Function) => {
    const err = new Error(stderr) as NodeJS.ErrnoException & { code?: string };
    if (code) err.code = code;
    callback(err, '', stderr);
  };
}

describe('gitTool definition', () => {
  it('has name "git"', () => {
    expect(gitTool.definition.name).toBe('git');
  });

  it('requires action parameter', () => {
    expect(gitTool.definition.parameters.required).toContain('action');
  });

  it('defines valid action enum', () => {
    const actionProp = gitTool.definition.parameters.properties.action as { enum: string[] };
    expect(actionProp.enum).toEqual(['status', 'diff', 'log', 'blame', 'branch', 'stash_list', 'remote']);
  });
});

describe('gitTool action: status', () => {
  it('parses porcelain v2 output with staged, unstaged, and untracked', async () => {
    mockGitSuccess(
      '# branch.head main\n' +
      '# branch.ab +2 -1\n' +
      '1 M. HEAD file1.ts\n' +
      '1 .M HEAD file2.ts\n' +
      '? untracked.txt\n',
    );

    const result = await gitTool.execute({ action: 'status' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Branch: main');
    expect(result.output).toContain('Ahead: 2');
    expect(result.output).toContain('Behind: 1');
    expect(result.output).toContain('Staged: 1');
    expect(result.output).toContain('Unstaged: 1');
    expect(result.output).toContain('Untracked: 1');
    expect(result.metadata?.branch).toBe('main');
    expect(result.metadata?.ahead).toBe(2);
    expect(result.metadata?.behind).toBe(1);
  });

  it('handles empty status (clean repo)', async () => {
    mockGitSuccess('# branch.head main\n# branch.ab +0 -0\n');

    const result = await gitTool.execute({ action: 'status' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Staged: 0');
    expect(result.output).toContain('Untracked: 0');
  });

  it('uses path as cwd', async () => {
    let capturedCwd: string | undefined;
    mockExecFileOverride = (_cmd: string, _args: string[], opts: any, callback: Function) => {
      capturedCwd = opts?.cwd;
      callback(null, '# branch.head main\n# branch.ab +0 -0\n', '');
    };

    const result = await gitTool.execute({ action: 'status', path: '/tmp/my-repo' });
    expect(result.success).toBe(true);
    expect(capturedCwd).toBe('/tmp/my-repo');
  });
});

describe('gitTool action: diff', () => {
  it('returns diff stat summary', async () => {
    mockGitSuccess(
      ' src/tools/builtin-git.ts | 120 ++++++++++++\n' +
      ' tests/tools/builtin-git.test.ts | 85 +++++++++\n' +
      ' 2 files changed, 205 insertions(+)\n',
    );

    const result = await gitTool.execute({ action: 'diff' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('builtin-git.ts');
    expect(result.output).toContain('2 files changed');
  });

  it('returns "No changes" for empty diff', async () => {
    mockGitSuccess('');

    const result = await gitTool.execute({ action: 'diff' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('No changes');
  });

  it('passes path to diff command', async () => {
    let capturedArgs: string[] = [];
    mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: Function) => {
      capturedArgs = args;
      callback(null, ' src/file.ts | 5 +-\n 1 file changed, 3 insertions(+), 2 deletions(-)\n', '');
    };

    const result = await gitTool.execute({ action: 'diff', path: '/repo/src/file.ts' });
    expect(result.success).toBe(true);
    expect(capturedArgs).toContain('--');
    expect(capturedArgs).toContain('/repo/src/file.ts');
  });
});

describe('gitTool action: log', () => {
  it('parses oneline log entries', async () => {
    mockGitSuccess(
      'abc1234 feat: add git tool\n' +
      'def5678 fix: resolve parsing bug\n' +
      'ghi9012 chore: update dependencies\n',
    );

    const result = await gitTool.execute({ action: 'log' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('abc1234 feat: add git tool');
    expect(result.output).toContain('def5678 fix: resolve parsing bug');
    expect(result.metadata?.count).toBe(3);
  });

  it('uses max_count parameter', async () => {
    let capturedArgs: string[] = [];
    mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: Function) => {
      capturedArgs = args;
      callback(null, 'abc1234 commit msg\n', '');
    };

    const result = await gitTool.execute({ action: 'log', max_count: 5 });
    expect(result.success).toBe(true);
    expect(capturedArgs).toContain('--max-count=5');
  });

  it('defaults max_count to 20', async () => {
    let capturedArgs: string[] = [];
    mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: Function) => {
      capturedArgs = args;
      callback(null, '', '');
    };

    const result = await gitTool.execute({ action: 'log' });
    expect(capturedArgs).toContain('--max-count=20');
  });

  it('passes branch name to log', async () => {
    let capturedArgs: string[] = [];
    mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: Function) => {
      capturedArgs = args;
      callback(null, '', '');
    };

    const result = await gitTool.execute({ action: 'log', branch: 'develop' });
    expect(capturedArgs).toContain('develop');
  });

  it('returns "No commits" for empty log', async () => {
    mockGitSuccess('');

    const result = await gitTool.execute({ action: 'log' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('No commits');
  });
});

describe('gitTool action: blame', () => {
  it('parses blame porcelain output', async () => {
    const blameOutput = [
      'a1b2c3d4e5f6789012345678901234567890abcd 1 1 1',
      'author Alice',
      'author-mail <alice@example.com>',
      'author-time 1700000000',
      'author-tz +0000',
      'committer Alice',
      'summary initial commit',
      'filename src/file.ts',
      '\tconst x = 1;',
      'f1e2d3c4b5a6789012345678901234567890abcd 2 2 1',
      'author Bob',
      'author-mail <bob@example.com>',
      'author-time 1700001000',
      'author-tz +0000',
      'committer Bob',
      'summary fix typo',
      'filename src/file.ts',
      '\tconst y = 2;',
    ].join('\n');

    mockGitSuccess(blameOutput);

    const result = await gitTool.execute({ action: 'blame', path: '/repo/src/file.ts' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Alice');
    expect(result.output).toContain('const x = 1;');
    expect(result.output).toContain('Bob');
    expect(result.output).toContain('const y = 2;');
    expect(result.metadata?.lines).toBe(2);
  });

  it('requires path parameter', async () => {
    const result = await gitTool.execute({ action: 'blame' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_path');
    expect(result.output).toContain('requires a file path');
  });

  it('passes branch name to blame', async () => {
    let capturedArgs: string[] = [];
    mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: Function) => {
      capturedArgs = args;
      callback(null, '', '');
    };

    await gitTool.execute({ action: 'blame', path: '/repo/file.ts', branch: 'main' });
    expect(capturedArgs).toContain('main');
  });
});

describe('gitTool action: branch', () => {
  it('returns branch list', async () => {
    mockGitSuccess(
      '* main          a1b2c3d feat: latest\n' +
      '  develop       f1e2d3c fix: bug\n' +
      '  remotes/origin/main abc1234 chore: update\n',
    );

    const result = await gitTool.execute({ action: 'branch' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('* main');
    expect(result.output).toContain('develop');
    expect(result.output).toContain('remotes/origin/main');
  });

  it('returns "No branches" for empty output', async () => {
    mockGitSuccess('');

    const result = await gitTool.execute({ action: 'branch' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('No branches');
  });
});

describe('gitTool action: stash_list', () => {
  it('returns stash entries', async () => {
    mockGitSuccess(
      'stash@{0}: WIP on main: a1b2c3d work in progress\n' +
      'stash@{1}: On develop: fix something\n',
    );

    const result = await gitTool.execute({ action: 'stash_list' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('stash@{0}');
    expect(result.output).toContain('work in progress');
    expect(result.output).toContain('stash@{1}');
  });

  it('returns "No stash entries" when empty', async () => {
    mockGitSuccess('');

    const result = await gitTool.execute({ action: 'stash_list' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('No stash entries');
  });
});

describe('gitTool action: remote', () => {
  it('returns remote URLs', async () => {
    mockGitSuccess(
      'origin\tgit@github.com:user/repo.git (fetch)\n' +
      'origin\tgit@github.com:user/repo.git (push)\n' +
      'upstream\thttps://github.com/other/repo.git (fetch)\n' +
      'upstream\thttps://github.com/other/repo.git (push)\n',
    );

    const result = await gitTool.execute({ action: 'remote' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('origin');
    expect(result.output).toContain('git@github.com:user/repo.git');
    expect(result.output).toContain('upstream');
  });

  it('returns "No remotes configured" when empty', async () => {
    mockGitSuccess('');

    const result = await gitTool.execute({ action: 'remote' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('No remotes configured');
  });
});

describe('gitTool error handling', () => {
  it('handles not a git repo', async () => {
    mockGitError('fatal: not a git repository (or any of the parent directories): .git');

    const result = await gitTool.execute({ action: 'status' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('not_a_git_repo');
    expect(result.output).toContain('Not a git repository');
  });

  it('handles git not installed', async () => {
    mockExecFileOverride = (_cmd: string, _args: string[], _opts: any, callback: Function) => {
      const err = new Error('spawn git ENOENT') as NodeJS.ErrnoException & { code?: string };
      err.code = 'ENOENT';
      callback(err, '', '');
    };

    const result = await gitTool.execute({ action: 'status' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('git_not_installed');
    expect(result.output).toContain('Git is not installed');
  });

  it('handles generic git error', async () => {
    mockGitError('fatal: bad revision');

    const result = await gitTool.execute({ action: 'log', branch: 'nonexistent-branch' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('git_error');
    expect(result.output).toContain('failed');
  });

  it('handles path safety check', async () => {
    const result = await gitTool.execute({
      action: 'status',
      path: 'C:\\Windows\\System32\\test',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('path_unsafe');
  });
});

describe('gitTool rejects invalid actions', () => {
  it('rejects unknown action', async () => {
    const result = await gitTool.execute({ action: 'commit' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_action');
    expect(result.output).toContain('Invalid git action');
  });

  it('rejects push action', async () => {
    const result = await gitTool.execute({ action: 'push' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_action');
  });

  it('rejects reset action', async () => {
    const result = await gitTool.execute({ action: 'reset' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_action');
  });

  it('rejects checkout action', async () => {
    const result = await gitTool.execute({ action: 'checkout' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_action');
  });

  it('rejects merge action', async () => {
    const result = await gitTool.execute({ action: 'merge' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_action');
  });
});
