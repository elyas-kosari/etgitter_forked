import { readFile } from 'node:fs/promises';
// import { SfCommand } from '@salesforce/sf-plugins-core';
// import inquirer from 'inquirer';
import { Git, IGitCommit } from './Git.js';
import { Settings } from './Settings.js';
import { Shell } from './Shell.js';
// import { Terminal } from "./Terminal";
import { LogLevel, Util } from './Util.js';

export type IRepo = {
  path: string;
  name: string;
  branches: string;
  order: number;
  files: {
    M?: string[];
    A?: string[];
    D?: string[];
  };
};

export type ConfirmAnswer = {
  continue: boolean;
};

export type GitOutput = {
  commit: IRepo;
  commitResults: string[];
  diff: string[];
  filesAM: string[];
  filesD: string[];
  folderName: string;
  hasCommit: boolean;
  index: number;
};

export class Repo {
  private settings: Settings;
  private sourceRepo: IGitCommit[];
  private commits: IRepo[];

  public constructor(settings: Settings) {
    this.settings = settings;
    this.sourceRepo = [];
    this.commits = [];
  }

  private static buildFileCountMessage(files: IGitCommit['files']): string {
    const counts = [];
    if (files.M) counts.push(`[Modified: ${files.M.length}]`);
    if (files.A) counts.push(`[Added: ${files.A.length}]`);
    if (files.D) counts.push(`[Deleted: ${files.D.length}]`);
    return `File counts: ${counts.join('')}`;
  }

  public async git2Folders(): Promise<number> {
    this.commits = [];

    try {
      await this.analyzeRepo();
      await Shell.deleteFolder(this.settings.git2Folder.destination);
      await this.git2FoldersLoop(0);

      this.cleanCommits();
      await Util.writeLog(`Commits processed: ${this.commits.length}`, LogLevel.INFO);
      await Shell.writeFileJson(this.settings.git2Folder.root, 'Control.json', this.commits, false);

      return this.commits.length;
    } catch (error) {
      await Util.throwError(error);
      throw error; // Preserve error chain
    }
  }

  public async folders2Git(): Promise<GitOutput[]> {
    const output: GitOutput[] = [];
    const commitsOrder: number[] = [];
    const commits = new Map<number, IRepo>();

    const data = await readFile(`${this.settings.folder2Git.root}/Control.json`, 'utf8');
    const json = JSON.parse(data) as IRepo[];

    json.forEach((commit: IRepo) => {
      commitsOrder.push(commit.order);
      commits.set(commit.order, commit);
    });

    await Shell.deleteFolder(this.settings.folder2Git.destination);
    await Shell.checkFolder(this.settings.folder2Git.destination);
    await Shell.deleteFolder(this.settings.folder2Git.output);
    await Shell.checkFolder(this.settings.folder2Git.output);
    await Shell.checkFolder(`${this.settings.folder2Git.output}/snapshot`);
    await Git.initializeRepo(this.settings.folder2Git.destination, this.settings.gitignore);
    await Git.makeBranch(this.settings.folder2Git.destination, 'Solutions', true);

    await this.folders2GitLoop(0, output, commits, commitsOrder);

    await Util.writeLog(`Checking out branch named: ${this.settings.branchToCheckout}`, LogLevel.TRACE);
    await Git.checkoutBranch(this.settings.folder2Git.destination, this.settings.branchToCheckout);

    await Util.writeLog('Creating output zips', LogLevel.TRACE);
    await Shell.checkFolder(this.settings.folder2Git.output);

    await Shell.makeZip(
      this.settings.folder2Git.root,
      './output/delta',
      `${this.settings.folder2Git.output}/solutions-delta.zip`
    );

    await Shell.makeZip(
      this.settings.folder2Git.root,
      this.settings.folder2Git.destination,
      `${this.settings.folder2Git.output}/exercises.zip`
    );

    await Shell.deleteFolder(`${this.settings.folder2Git.output}/snapshot`);
    await Shell.deleteFolder(`${this.settings.folder2Git.output}/delta`);
    await Shell.writeFileJson(this.settings.folder2Git.root, 'Log_F2G.json', output);

    return output;
  }

  public async beautify(): Promise<number> {
    let countBeautyChanges = 0;

    try {
      const files = await Shell.getAllFiles(this.settings.folder2Git.source);
      await Util.writeLog(`Beautifying files in [${this.settings.folder2Git.source}]`, LogLevel.TRACE);

      await Util.serialize(this, files, async (index: number): Promise<void> => {
        const fileName = files[index];
        const changed = await Shell.beautify(this.settings.folder2Git.source, fileName);

        if (changed) {
          countBeautyChanges++;
          await Util.writeLog(`File was modified ${fileName}`, LogLevel.INFO);
        }
      });

      return countBeautyChanges;
    } catch (error) {
      await Util.throwError(error);
      throw error;
    }
  }

  public async history(fileName: string, isBefore: boolean): Promise<string[]> {
    const rootFolder = isBefore ? this.settings.git2Folder.source : this.settings.folder2Git.destination;
    const fullOutput: string[] = [];

    try {
      const files = await Shell.searchFiles(rootFolder, true, fileName);

      if (files.length === 0) {
        await Util.writeLog(`Nothing found for [${fileName}]. No history will be displayed`, LogLevel.WARN);
        return fullOutput;
      }

      await Util.serialize(this, files, async (index: number): Promise<void> => {
        const file = files[index];
        const filePath = `${file.path}/${file.fileName}`;
        const output = await Git.history(rootFolder, filePath);

        const processingMsg = `Processing ${filePath}`;
        fullOutput.push(processingMsg);
        await Util.writeLog(processingMsg, LogLevel.INFO);

        const logPromises = output.map((line) => {
          fullOutput.push(line);
          return Util.writeLog(line, LogLevel.INFO);
        });
        await Promise.all(logPromises);
      });

      return fullOutput;
    } catch (error) {
      await Util.throwError(error);
      throw error;
    }
  }

  public async testPush(isBefore: boolean): Promise<string[]> {
    const cmds: string[] = [];
    const rootFolder = isBefore ? this.settings.git2Folder.source : this.settings.folder2Git.destination;

    try {
      const commits = await Git.analyzeRepo(rootFolder, true);

      commits.forEach((commit) => cmds.push(commit.refs));
      const output = cmds.join('\n');

      await Shell.writeFileGeneric(this.settings.folder2Git.output, '/testPush_branches.txt', output);

      return cmds;
    } catch (error) {
      await Util.throwError(error);
      throw error;
    }
  }

  // private showOutput(msg: string): void {
  //   void Util.writeLog(msg, LogLevel.INFO);
  // }

  // public find(path: string, byFileName: boolean, isEdit: boolean, search: string): Promise<string[]> {
  //   let msg = '';
  //   const promptMsg = Util.consoleBold('Do you want to edit this [Y/N]?');

  //   return new Promise((resolve) => {
  //     msg = `Searching By ${byFileName ? 'FileName' : 'Contents'} for [${search}] in ${path}`;
  //     Util.writeLog(msg, LogLevel.TRACE);
  //     Shell.searchFiles(path, byFileName, search)
  //       .then((files: IShellFindResults[]) => {
  //         Util.clearScreen();
  //         this.showOutput(`Files found at [${path}]`);

  //         Util.serialize(this, files, (index: number): Promise<void> => {
  //           return new Promise(async (resolveEach) => {
  //             const file: IShellFindResults = files[index];
  //             if (isEdit) {
  //               msg = '';
  //               let openCode: boolean = false;

  //               if (byFileName) {
  //                 this.showOutput(`[${file.fileName}]`);
  //                 msg += promptMsg;
  //                 openCode = await inquirer
  //                   .prompt([
  //                     {
  //                       type: 'confirm',
  //                       name: 'continue',
  //                       message: msg,
  //                     },
  //                   ])
  //                   .then((answers) => answers.continue);
  //               } else {
  //                 this.showOutput(file.fileName);
  //                 file.results.sort().forEach((value: string) => {
  //                   this.showOutput(`\t${value}`);
  //                 });
  //                 msg = `\t${promptMsg}`;
  //                 openCode = await SfCommand.prototype.confirm({
  //                   message: msg,
  //                 });
  //               }

  //               if (openCode) {
  //                 let cmd = `code  `;
  //                 if (!byFileName) {
  //                   cmd += ` -g `;
  //                 }
  //                 cmd += `"${file.path}/${file.fileName}"`;
  //                 if (!byFileName) {
  //                   cmd += `:${file.results[0].split(':')[0]}`;
  //                 }
  //                 Shell.execute(file.path, cmd)
  //                   .then((value: IShellExecResult) => {
  //                     resolveEach();
  //                   })
  //                   .catch((err) => {
  //                     Util.throwError(err);
  //                   });
  //               } else {
  //                 resolveEach();
  //               }
  //             } else {
  //               this.showOutput(file.fileName);
  //               if (!byFileName) {
  //                 file.results.sort().forEach((value: string) => {
  //                   this.showOutput(`\t${value}`);
  //                 });
  //               }
  //               resolveEach();
  //             }
  //           });
  //         });
  //       })
  //       .then(() => {
  //         resolve([]);
  //       })
  //       .catch((err) => {
  //         Util.throwError(err);
  //       });
  //   });
  // }

  private async analyzeRepo(): Promise<IGitCommit[]> {
    try {
      const results = await Git.analyzeRepo(this.settings.git2Folder.source, true);
      this.sourceRepo = results;

      await Shell.writeFileJson(this.settings.git2Folder.root, 'Log_G2F.json', results, false);

      return results;
    } catch (error) {
      await Util.throwError(error);
      throw error; // Ensures proper return type and error propagation
    }
  }

  private async git2FoldersLoop(index: number): Promise<void> {
    try {
      if (index >= this.sourceRepo.length) {
        return;
      }

      const commit = this.sourceRepo[index];
      await this.commit2Folder(index, commit);
      await this.git2FoldersLoop(index + 1);
    } catch (error) {
      await Util.throwError(error);
    }
  }

  private async commit2Folder(index: number, commit: IGitCommit): Promise<void> {
    const adjustedIndex = index * 10;

    const data: IRepo = {
      branches: commit.refs,
      files: commit.files,
      name: commit.subject,
      order: adjustedIndex,
      path: '',
    };

    if (data.branches) {
      data.branches = data.branches.startsWith('tag: ')
        ? data.branches.replace(/tag: /g, 'tag|')
        : `branch|${data.branches}`;
    }

    const folderName = `${adjustedIndex.toString().padStart(5, '0')}_${data.branches}`;
    const folderPath = `${this.settings.git2Folder.destination}/${folderName}`;

    try {
      data.path = await Shell.checkFolder(folderPath);
      this.commits.push(data);

      await Git.checkoutComit(this.settings.git2Folder.source, commit);

      const fileCountMsg = Repo.buildFileCountMessage(commit.files);
      await Util.writeLog(
        `Processing commit ${adjustedIndex / 10 + 1}: ${data.branches} | ${data.name} | ${fileCountMsg}`,
        LogLevel.INFO
      );

      const copyPromises = this.createFileCopyPromises(commit.files, data.path);
      await Promise.all(copyPromises);

      if (this.settings.sleepTimer > 10) {
        const sleepMsg = `Sleeping for ${this.settings.sleepTimer / 1000.0} seconds@${Util.getWallTime(true)} `;
        await Util.writeLog(sleepMsg, LogLevel.TRACE);
        await new Promise((resolve) => setTimeout(resolve, this.settings.sleepTimer));
      }
    } catch (error) {
      await Util.throwError(error);
      throw error;
    }
  }

  private createFileCopyPromises(files: IGitCommit['files'], destPath: string): Array<Promise<void>> {
    const promises: Array<Promise<void>> = [];

    Object.entries(files).forEach(([key, fileList]) => {
      switch (key) {
        case 'M':
        case 'A':
          fileList.forEach((fileName) => {
            const sourcePath = `${this.settings.git2Folder.source}/${fileName}`;
            const destFilePath = `${destPath}/${fileName}`;
            promises.push(Shell.copyFile(sourcePath, destFilePath));
          });
          break;
        case 'D':
          break;
        default:
          throw new Error(`Unknown operation [${key}] on repo`);
      }
    });

    return promises;
  }

  private async folders2GitLoop(
    index: number,
    output: GitOutput[],
    commits: Map<number, IRepo>,
    commitsOrder: number[]
  ): Promise<void> {
    if (index >= commitsOrder.length) {
      return;
    }

    const commitOrder = commitsOrder[index];
    const commit = commits.get(commitOrder);

    if (!commit) {
      throw new Error(`No commit found for order: ${commitOrder}`);
    }

    const parts = commit.path.split('/');
    parts.shift(); // Removes "."
    parts.shift(); // Removes "02-Folders"
    const folderName = parts.join('/');

    const msg = `Processing folder #${index + 1} of ${commitsOrder.length} => ${folderName} (${commit.name})`;
    await Util.writeLog(msg, LogLevel.INFO);

    const value: GitOutput = await this.folder2Git(index, folderName, commit);
    output.push(value);

    await this.folders2GitLoop(index + 1, output, commits, commitsOrder);
  }

  private async folder2Git(index: number, folderName: string, commit: IRepo): Promise<GitOutput> {
    const output = {
      commit,
      commitResults: [] as string[],
      diff: [] as string[],
      filesAM: [] as string[],
      filesD: [] as string[],
      folderName,
      hasCommit: commit !== null,
      index,
    };

    try {
      // Copy files to new repo
      const files = await Shell.getAllFiles(`${this.settings.folder2Git.source}/${folderName}`);
      const copyPromises = files.map((file) => {
        output.filesAM.push(file);
        return Shell.copyFile(
          `${this.settings.folder2Git.source}/${folderName}/${file}`,
          `${this.settings.folder2Git.destination}/${file}`
        );
      });
      await Promise.all(copyPromises);

      // Delete old files from repo
      if (commit.files.D) {
        const deletePromises = commit.files.D.map(async (file) => {
          const fileName = await Shell.deleteFile(`${this.settings.folder2Git.destination}/${file}`);
          if (fileName) {
            output.filesD.push(file);
          }
        });
        await Promise.all(deletePromises);
      }

      // Get and stage differences
      output.diff = await Git.getDiff(this.settings.folder2Git.destination);
      await Git.stage(this.settings.folder2Git.destination);

      // Commit changes
      output.commitResults = await Git.commit(this.settings.folder2Git.destination, commit.name);

      // Create branch if needed
      if (commit.branches) {
        await Git.makeBranch(this.settings.folder2Git.destination, commit.branches);
      }

      // Copy deltas if files were changed
      if (output.filesAM.length + output.filesD.length > 0) {
        try {
          await Shell.copyFolder(
            `${this.settings.folder2Git.source}/${folderName}`,
            `${this.settings.folder2Git.output}/delta/${commit.branches}`
          );
        } catch {
          // Ignore copy errors
        }
      }

      // Handle sleep timer
      if (this.settings.sleepTimer > 10) {
        const sleepMsg = `Sleeping for ${this.settings.sleepTimer / 1000.0} seconds @ ${Util.getWallTime(true)}`;
        await Util.writeLog(sleepMsg, LogLevel.TRACE);
        await new Promise((resolve) => setTimeout(resolve, this.settings.sleepTimer));
      }

      return output;
    } catch (error) {
      await Util.throwError(error);
      throw error;
    }
  }

  private cleanCommits(): void {
    if (this.settings.fullDebugMode) {
      return;
    }

    this.commits.forEach((commit) => {
      delete commit.files.A;
      delete commit.files.M;
    });
  }
}
