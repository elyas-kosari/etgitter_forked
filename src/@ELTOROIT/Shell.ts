import * as fs from 'node:fs';
import { exec, ExecException } from 'node:child_process'; // https://nodejs.org/api/child_process.html
import * as fsNode from 'node:fs';
import * as pathNode from 'node:path';
import { LogLevel, Util } from './Util.js';

export type IShellExecResult = {
  cmd: string;
  error: ExecException | null;
  stderr: string;
  stdout: string;
};

export type IShellFindResults = {
  path: string;
  fileName: string;
  results: string[];
};

export class Shell {
  private static readonly fileTypes: {
    binary: readonly string[];
    text: readonly string[];
  } = {
    binary: ['ASSET', 'DB', 'CREATEFOLDER', 'GIF', 'MD', 'MP3', 'PNG', 'ZIP'],
    text: [
      'APP',
      'AURADOC',
      'CLS',
      'CMP',
      'CSS',
      'DESIGN',
      'EAAPEX',
      'EVT',
      'FLEXIPAGE',
      'FORCEIGNORE',
      'JS',
      'JSON',
      'PAGE',
      'SH',
      'SVG',
      'TOKENS',
      'TRIGGER',
      'TXT',
      'XML',
    ],
  };
  // tslint:disable-next-line:max-line-length
  public static async execute(path: string, command: string, throwErrors = true): Promise<IShellExecResult> {
    const result = await new Promise<IShellExecResult>((resolve, reject) => {
      exec(command, { cwd: path }, (error, stdout, stderr) => {
        if (throwErrors && error) {
          void Util.writeLog('*** ERROR ***', LogLevel.FATAL);
          void Util.writeLog(`Path: ${path}`, LogLevel.FATAL);
          void Util.writeLog(`Command: ${command}`, LogLevel.FATAL);
          void Util.writeLog(`stdout: ${stdout}`, LogLevel.FATAL);
          void Util.writeLog(`stderr: ${stderr}`, LogLevel.FATAL);
          void Util.writeLog(`error: ${error.message}`, LogLevel.FATAL);
          void Util.throwError(error);
          reject(error);
          return;
        }

        resolve({
          cmd: command,
          error,
          stderr,
          stdout,
        });
      });
    });

    return result;
  }

  public static async writeFileGeneric(
    folder: string,
    fileName: string,
    data: string | Buffer | Uint8Array,
    withDate = false
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      this.checkFolder(folder, withDate)
        .then((newFolder) => {
          const filePath = `${newFolder}/${fileName}`;
          return fs.writeFile(filePath, data, (err) => {
            if (err) throw err;
          });
        })
        .then(() => {
          resolve();
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static writeFileJson(folder: string, fileName: string, data: object, withDate = false): Promise<void> {
    const isVerbose = true;
    const strData = isVerbose ? JSON.stringify(data, null, '  ') : JSON.stringify(data);

    return this.writeFileGeneric(folder, fileName, strData, withDate);
  }

  public static async readFileBuffer(folder: string, fileName: string, withDate = false): Promise<Buffer> {
    return new Promise<Buffer>((resolve) => {
      this.checkFolder(folder, withDate)
        .then((newFolder) => {
          const filePath = `${newFolder}/${fileName}`;
          fs.readFile(filePath, (err, data) => {
            if (err) {
              void Util.throwError(err);
            }
            resolve(data);
          });
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static async readFileText(folder: string, fileName: string, withDate = false): Promise<string> {
    return new Promise((resolve) => {
      this.readFileBuffer(folder, fileName, withDate)
        .then((value: Buffer) => {
          resolve(value.toString());
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static async readFileJson(folder: string, fileName: string, withDate = false): Promise<unknown> {
    return new Promise<unknown>((resolve) => {
      this.readFileText(folder, fileName, withDate)
        .then((value: string) => {
          resolve(JSON.parse(value));
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static checkFolder(folder: string, withDate = false): Promise<string> {
    return new Promise((resolve) => {
      fs.mkdir(folder, { recursive: true }, (mainErr) => {
        if (mainErr) {
          void Util.throwError(mainErr);
          return;
        }

        if (withDate) {
          folder += Util.getWallTime(false).replace('T', '/');
          fs.mkdir(folder, { recursive: true }, (subErr) => {
            if (subErr) {
              void Util.throwError(subErr);
              return;
            }
            resolve(folder);
          });
        } else {
          resolve(folder);
        }
      });
    });
  }

  public static async deleteFolder(folder: string): Promise<void> {
    return new Promise<void>((resolve) => {
      fs.rm(folder, { recursive: true, force: true }, (err) => {
        if (err) {
          if (err.code === 'ENOENT') {
            resolve();
          } else {
            void Util.throwError(err);
          }
          return;
        }
        resolve();
      });
    });
  }

  public static deleteFile(fileName: string): Promise<string | null> {
    return new Promise((resolve) => {
      const exists = fsNode.existsSync(fileName);

      if (exists) {
        fsNode.unlinkSync(fileName);
        resolve(fileName);
      } else {
        resolve(null);
      }
    });
  }

  public static async copyFile(fromFile: string, toFile: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const toFolder = pathNode.dirname(toFile);

      this.checkFolder(toFolder)
        .then(() => {
          const cmd = `cp "${fromFile}" "${toFolder}"`;
          return Shell.execute('.', cmd);
        })
        .then(() => {
          resolve();
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static async copyFolder(fromFolder: string, toFolder: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.checkFolder(fromFolder)
        .then(() => this.checkFolder(toFolder))
        .then(() => {
          const cmd = `cp -r "${fromFolder}/" "${toFolder}"`;
          return Shell.execute('.', cmd);
        })
        .then(() => {
          resolve();
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static async getFolderNames(path: string): Promise<string[]> {
    return new Promise<string[]>((resolve) => {
      const cmd = 'ls -ld1 ./*/';

      Shell.execute(path, cmd)
        .then((shellResult: IShellExecResult) => {
          const folderNames = this.text2lines(shellResult.stdout).map((folderName: string) => folderName.split('/')[1]);
          resolve(folderNames);
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static async isFile(path: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.stats(path)
        .then((stats: fsNode.Stats) => {
          resolve(stats.isFile());
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static async getAllFiles(path: string): Promise<string[]> {
    return new Promise<string[]>((resolve) => {
      this.isFile(path)
        .then((isFile: boolean) => {
          if (isFile) {
            return [path];
          }

          const cmd = 'find . -name "*" -type f | sort';
          return Shell.execute(path, cmd).then((shellResult: IShellExecResult) =>
            this.text2lines(shellResult.stdout)
              .map((fileName: string) => (fileName.startsWith('./') ? fileName.slice(2) : fileName))
              .filter(Boolean)
          );
        })
        .then((fileNames: string[]) => {
          resolve(fileNames);
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static async searchFiles(path: string, byFileName: boolean, search: string): Promise<IShellFindResults[]> {
    return new Promise<IShellFindResults[]>((resolve) => {
      const cmd = byFileName ? `find . -iname "${search}" | sort` : `grep -rni . -e "${search}" | sort`;

      Shell.execute(path, cmd)
        .then((shellResult: IShellExecResult) => {
          let last: IShellFindResults | null = null;
          const files: IShellFindResults[] = [];

          this.text2lines(shellResult.stdout).map((line: string) => {
            if (byFileName) {
              if (line.startsWith('./')) {
                files.push({
                  fileName: line.substring(2),
                  path,
                  results: [],
                });
                return;
              } else if (line.startsWith(path)) {
                files.push({
                  fileName: line.replace(path, '').substr(1),
                  path,
                  results: [],
                });
              } else {
                void Util.assert(false, 'Why are you here?');
              }
            } else {
              const parts = line.split(':');
              const fileName = parts[0].substr(2);
              const lineNumber = parts[1];
              const results = line.substring((fileName + ':' + lineNumber).length + 3).trim();

              if (!last || last.fileName !== fileName) {
                last = {
                  fileName,
                  path,
                  results: [`${lineNumber.padStart(3, '0')}: ${results}`],
                };
                files.push(last);
              } else {
                last.results.push(`${lineNumber.padStart(3, '0')}: ${results}`);
              }
            }
          });
          resolve(files);
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static text2lines(text: string): string[] {
    const output = text.split('\n');

    if (output[output.length - 1] === '') {
      output.pop();
    }

    return output;
  }

  public static isText(fileName: string): boolean {
    const lastDotPos = fileName.lastIndexOf('.');
    const ext = fileName.substring(lastDotPos + 1).toUpperCase();
    let isFound = false;
    let isText = false;

    if (this.fileTypes.text.includes(ext)) {
      isFound = true;
      isText = true;
    }

    if (!isFound && this.fileTypes.binary.includes(ext)) {
      isFound = true;
      isText = false;
    }

    void Util.assertEquals(true, isFound, `Extension[${ext}]for file[${fileName}]was not found`);
    return isText;
  }

  public static parseFolderFile(path: string, fileName: string): { fileName: string; path: string } {
    const fullpath = `${path}/${fileName}`;
    const lastPos = fullpath.lastIndexOf('/');

    return {
      fileName: fullpath.substring(lastPos + 1),
      path: fullpath.substring(0, lastPos),
    };
  }

  public static async beautify(path: string, fileName: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const tmp = this.parseFolderFile(path, fileName);
      path = tmp.path;
      fileName = tmp.fileName;

      if (!this.isText(fileName)) {
        return resolve(false);
      }

      let fileBefore: string;
      void Util.writeLog(`Beautifying ${fileName} `, LogLevel.TRACE);

      this.readFileText(path, fileName)
        .then((value) => {
          fileBefore = value;
          const cmd = `sed - i "" "h;s/[^ ].*//;s/    / /g;G;s/\\n *//" "${fileName}"`;
          return this.execute(path, cmd);
        })
        .then(() => {
          const cmd = `sed - i "" "s/[[:blank:]]*$//" "${fileName}"`;
          return this.execute(path, cmd);
        })
        .then(() => this.readFileText(path, fileName))
        .then((fileAfter) => {
          resolve(fileBefore !== fileAfter);
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  public static async makeZip(root: string, path: string, zipFile: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const fullRoot = pathNode.resolve('.', root);
      const fullZipFile = pathNode.resolve('.', zipFile);
      const fullPath = pathNode.resolve('.', path);
      const fullLog = pathNode.resolve(fullRoot, 'ziplog.txt');

      this.execute(fullPath, `zip -r -X -v -dc -lf "${fullLog}" -li "${fullZipFile}" .`)
        .then(() => {
          resolve();
        })
        .catch((err) => {
          void Util.throwError(err);
        });
    });
  }

  private static stats(path: string): Promise<fsNode.Stats> {
    return new Promise((resolve, reject) => {
      fsNode.stat(path, (err: NodeJS.ErrnoException | null, stats: fsNode.Stats) => {
        if (err) {
          reject(err);
        } else {
          resolve(stats);
        }
      });
    });
  }
}
