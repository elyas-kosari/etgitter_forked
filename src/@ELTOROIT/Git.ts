import { IShellExecResult, Shell } from './Shell.js';
import { LogLevel, Util } from './Util.js';

export type IGitCommitWho = {
  name: string;
  email: string;
  date_relative: string;
  date: string;
};

export type IGitCommitHash = {
  full: string;
  short: string;
};

export type IGitCommit = {
  commit: IGitCommitHash;
  tree: IGitCommitHash;
  parent: IGitCommitHash;
  author: IGitCommitWho;
  commiter: IGitCommitWho;
  refs: string;
  encoding: string;
  subject: string;
  sanitized_subject_line: string;
  body: string;
  body_raw: string;
  commit_notes: string;
  verification_flag: string;
  signer: string;
  signer_key: string;
  files: Record<string, string[]>;
};

export type GitCommitRaw = {
  commit: IGitCommitHash;
  tree: IGitCommitHash;
  parent: IGitCommitHash;
  author: IGitCommitWho;
  commiter: IGitCommitWho;
  refs: string;
  encoding: string;
  subject: string;
  sanitized_subject_line: string;
  body: string;
  body_raw: string;
  commit_notes: string;
  verification_flag: string;
  signer: string;
  signer_key: string;
};

export class Git {
  public static statusAllFiles: Set<string>;

  public static async analyzeRepo(path: string, isRecentFirst: boolean): Promise<IGitCommit[]> {
    this.statusAllFiles = new Set<string>();

    const cmd = `git log --all --topo-order --pretty=format:"${this.makePrettyLogFormat()}"`;

    await Util.writeLog('Getting Git logs: ' + path, LogLevel.DEBUG);

    const shellResult = await Shell.execute(path, cmd);
    let commits = this.commitsFromShell(shellResult);

    await this.getChangesPerCommit(path, commits);

    if (isRecentFirst) {
      commits = commits.reverse();
    }

    await this.showStatusAllFiles();
    return commits;
  }

  public static async checkoutComit(path: string, commit: IGitCommit): Promise<void> {
    const cmd = `git checkout --force --quiet ${commit.commit.full}`;

    try {
      const shellResult = await Shell.execute(path, cmd);
      await Util.writeLog(shellResult, LogLevel.TRACE);
    } catch (err) {
      await Util.throwError(err);
      throw err;
    }
  }

  public static async checkoutBranch(path: string, branchName: string): Promise<void> {
    try {
      await Shell.execute(path, `git checkout ${branchName}`);
      await Shell.execute(path, 'git config core.fileMode false');
    } catch (err) {
      await Util.throwError(err);
      throw err;
    }
  }

  public static async initializeRepo(path: string, gitignore: string[]): Promise<void> {
    try {
      await Shell.execute(path, 'git init');
      await Shell.execute(path, 'echo "# Ignore these files..." > .gitignore');

      const promises = gitignore.map((line) => Shell.execute(path, `echo ${line} >> .gitignore`));

      await Promise.all(promises);
    } catch (err) {
      await Util.throwError(err);
    }
  }

  public static async getDiff(path: string): Promise<string[]> {
    const shellResult = await Shell.execute(path, 'git diff');
    return Shell.text2lines(shellResult.stdout);
  }

  public static async stage(path: string): Promise<void> {
    try {
      await Shell.execute(path, 'git add .');
    } catch (err) {
      await Util.throwError(err);
    }
  }

  public static async commit(path: string, commitMessage: string): Promise<string[]> {
    const shellResult = await Shell.execute(path, `git commit -m "${commitMessage}"`);
    return Shell.text2lines(shellResult.stdout);
  }

  public static async makeBranch(path: string, branchName: string, checkOutNewBranch = false): Promise<void> {
    let cmd = '';
    let isTag = false;
    let isBranch = false;
    const parts = branchName.split('|');

    switch (parts.length) {
      case 1:
        isBranch = true;
        break;
      case 2:
        switch (parts[0]) {
          case 'branch':
            isBranch = true;
            branchName = parts[1];
            break;
          case 'tag':
            isTag = true;
            branchName = parts[1];
            break;
        }
        break;
    }

    if (isBranch) {
      cmd = checkOutNewBranch ? `git checkout -b ${branchName}` : `git branch ${branchName}`;
    } else if (isTag) {
      cmd = `git tag ${branchName}`;
    }

    try {
      await Shell.execute(path, cmd);
    } catch (err) {
      await Util.throwError(err);
    }
  }

  public static async history(path: string, fileName: string): Promise<string[]> {
    const value = await Shell.execute(path, `git log --all --topo-order --reverse -p "${fileName}"`);
    return Shell.text2lines(value.stdout);
  }

  private static async getChangesPerCommit(path: string, commits: IGitCommit[]): Promise<void> {
    try {
      const promises = commits.map(async (commit) => {
        const cmd = `git diff-tree --no-commit-id --name-status -r ${commit.commit.full}`;
        commit.files = {} as Record<string, string[]>;

        const shellResult = await Shell.execute(path, cmd, true);
        const lines = Shell.text2lines(shellResult.stdout);

        const linePromises = lines.map(async (line) => {
          const parts = line.split('\t');
          await Util.assertEquals(2, parts.length, 'Each log line should have exactly 2 parts separated with a TAB');

          const [status, file] = parts;
          await Util.assertNotEquals('X', status, 'https://git-scm.com/docs/git-diff-tree asks to report type X');

          this.statusAllFiles.add(status);
          const files = commit.files[status] || [];
          files.push(file);
          commit.files[status] = files;
        });

        await Promise.all(linePromises);
      });

      await Promise.all(promises);
    } catch (err) {
      await Util.throwError(err);
    }
  }

  private static makePrettyLogFormat(): string {
    return `{
      {
        'commit': {'full': '%H', 'short': '%h'},
        'tree': {'full': '%T', 'short': '%t'},
        'parent': {'full': '%P', 'short': '%p'},
        'author': {
          'name': '%aN',
          'email': '%aE',
          'date_relative': '%ar',
          'date': '%aI'
        },
        'commiter': {
          'name': '%cN',
          'email': '%cE',
          'date_relative': '%cr',
          'date': '%cI'
        },
        'refs': '%D',
        'subject': '%s'
      },`;
  }

  private static commitsFromShell(shellResult: IShellExecResult): IGitCommit[] {
    const strResult = `[${shellResult.stdout.slice(0, -1)}]`.replace(/"/g, '"').replace(/'/g, '"');

    const parsedData = JSON.parse(strResult) as GitCommitRaw[];

    const typedCommits: IGitCommit[] = parsedData.map((rawCommit) => {
      const refsArray = rawCommit.refs
        .replace('->', ',')
        .split(',')
        .map((value) => value.trim())
        .filter((item) => !['HEAD', 'origin/HEAD', 'Solutions', 'origin/Solutions', 'origin/master'].includes(item));

      let finalRefs = '';
      if (refsArray.length === 1) {
        finalRefs = refsArray[0].startsWith('origin/') ? refsArray[0].replace('origin/', '') : refsArray[0];
      } else if (refsArray.length > 1) {
        void Util.throwError(`Can't have more than one branch on the same commit! ${JSON.stringify(rawCommit)}`);
      }

      return {
        ...rawCommit,
        refs: finalRefs,
        files: {} as Record<string, string[]>,
      };
    });

    return typedCommits;
  }

  private static async showStatusAllFiles(): Promise<void> {
    const msg = Array.from(this.statusAllFiles).join(', ');
    await Util.writeLog(`Files's status found in repo: ${msg}`, LogLevel.TRACE);
  }
}
