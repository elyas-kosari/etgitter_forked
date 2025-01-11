import { AnyJson, Dictionary, toAnyJson } from '@salesforce/ts-types';
import { ConfigFile } from '@salesforce/core';
import { Shell } from './Shell.js';
import { LogLevel, Util } from './Util.js';

/*
How to add a new entry in the config file?
- Add an entry to the ISettingsValues interface.
- Implement the field in this class.
- Read the value in processFile()
- Write the field in valuesToWrite()
*/

export type ISettingsPath = {
  destination: string;
  source: string;
  root: string;
  output: string;
};

export type ISettingsValues = {
  isValid: boolean;
  folder2Git: ISettingsPath;
  git2Folder: ISettingsPath;
  fullDebugMode: boolean;
  branchToCheckout: string;
  gitignore: string[];
  sleepTimer: number;
};

export class Settings implements ISettingsValues {
  public isValid: boolean = false;
  public sleepTimer: number = 0;
  public folder2Git: ISettingsPath = {
    destination: '',
    source: '',
    root: '',
    output: '',
  };
  public git2Folder: ISettingsPath = {
    destination: '',
    source: '',
    root: '',
    output: '',
  };
  public fullDebugMode: boolean = false;
  public branchToCheckout: string = '';
  public gitignore: string[] = [];

  // Local private variables
  private configFile!: ConfigFile<ConfigFile.Options>;

  public static read(): Promise<Settings> {
    const s: Settings = new Settings();
    s.resetValues();
    return s.readAll();
  }

  private static openConfigFile(folder: string): Promise<ConfigFile<ConfigFile.Options>> {
    return ConfigFile.create({
      filename: 'ETGitter.json',
      isGlobal: false,
      isState: false,
      rootFolder: folder,
    });
  }

  private async readAll(): Promise<Settings> {
    try {
      const settingsPath = await Shell.checkFolder('.', false);
      const configFile = await Settings.openConfigFile(settingsPath);
      this.configFile = configFile;

      const fileExists = await this.configFile.exists();
      if (!fileExists) {
        this.isValid = false;
        const configPath = this.configFile.getPath();
        await this.write();
        throw new Error(
          `Configuration file [${configPath}] did not exist and was created with default values. Please fix it and run again`
        );
      }

      await this.processFile();
      return this;
    } catch (error) {
      await Util.throwError(error);
      throw error; // For TypeScript completeness
    }
  }

  private async processFile(): Promise<Settings> {
    this.isValid = true;

    try {
      const resValues = await this.configFile.read();

      // Process all settings in parallel for better performance
      const promises = [
        this.processPaths(resValues, 'git2Folder').then((data) => {
          this.git2Folder = data;
        }),

        this.processPaths(resValues, 'folder2Git').then((data) => {
          this.folder2Git = data;
        }),

        this.processStringValues(resValues, 'branchToCheckout', false).then((value) => {
          this.branchToCheckout = value;
        }),

        this.processsComplexValues<string[]>(resValues, 'gitignore', false).then((value) => {
          this.gitignore = value ?? [];
        }),

        this.processStringValues(resValues, 'sleepTimer', false).then((value) => {
          this.sleepTimer = parseInt(value, 10);
        }),

        this.processStringValues(resValues, 'fullDebugMode', false).then((value) => {
          this.fullDebugMode = value === 'true';
        }),
      ];

      await Promise.all(promises);
      await this.write();

      return this;
    } catch (error) {
      await Util.throwError(error);
      throw error; // TypeScript completeness
    }
  }

  private async processPaths(resValues: Dictionary<AnyJson>, entryName: string): Promise<ISettingsPath> {
    try {
      const tmpData = (await this.processsComplexValues(resValues, entryName, true)) as ISettingsPath;

      const data: ISettingsPath = {
        destination: tmpData.destination,
        output: tmpData.output,
        root: tmpData.root,
        source: tmpData.source,
      };

      // Log configuration values using template literals
      await Util.writeLog(`Configuration value for [${entryName}.source]: ${data.source}`, LogLevel.INFO);
      await Util.writeLog(`Configuration value for [${entryName}.destination]: ${data.destination}`, LogLevel.INFO);
      await Util.writeLog(`Configuration value for [${entryName}.root]: ${data.root}`, LogLevel.INFO);
      await Util.writeLog(`Configuration value for [${entryName}.output]: ${data.output}`, LogLevel.INFO);

      // Check and update folder paths sequentially
      data.root = await Shell.checkFolder(data.root);
      data.source = await Shell.checkFolder(data.source);
      data.destination = await Shell.checkFolder(data.destination);

      return data;
    } catch (error) {
      await Util.throwError(error);
      throw error;
    }
  }

  private processsComplexValues<T>(
    resValues: Dictionary<AnyJson>,
    entryName: string,
    isRequired: boolean
  ): Promise<T | null> {
    return new Promise((resolve, reject) => {
      if (!Object.hasOwn(resValues, entryName)) {
        if (isRequired) {
          this.isValid = false;
          reject(`Config file does not have an entry for [${entryName}]`);
        }
        resolve(null);
        return;
      }

      const data = resValues[entryName] as T;

      if (data == null && isRequired) {
        this.isValid = false;
        reject(`Config file has no entry for [${entryName}] but it's null`);
        return;
      }

      resolve(data);
    });
  }

  private processStringValues(resValues: Dictionary<AnyJson>, entryName: string, isRequired: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!Object.hasOwn(resValues, entryName)) {
        if (isRequired) {
          this.isValid = false;
          reject(`Config file does not have an entry for [${entryName}]`);
        }
        resolve('');
        return;
      }

      const value = String(resValues[entryName] ?? '');
      const valueStr = value ?? '';

      void Util.writeLog(`Configuration value for [${entryName}]: ${valueStr}`, LogLevel.INFO);
      resolve(valueStr);
    });
  }

  private async write(): Promise<object> {
    const values = this.valuesToWrite();
    for (const [key, value] of Object.entries(values)) {
      this.configFile.set(key, value);
    }
    return this.configFile.write();
  }

  private valuesToWrite(): Dictionary<AnyJson> {
    return {
      // Debug timestamp for file change tracking
      now: toAnyJson(new Date()),

      // Core settings
      git2Folder: toAnyJson(this.git2Folder),
      folder2Git: toAnyJson(this.folder2Git),
      sleepTimer: this.sleepTimer,
      fullDebugMode: this.fullDebugMode,
      gitignore: this.gitignore,
      branchToCheckout: this.branchToCheckout,
    };
  }

  private resetValues(): void {
    this.isValid = false;
    this.git2Folder = {
      destination: '',
      output: '',
      root: '',
      source: '',
    };
    this.folder2Git = {
      destination: '',
      output: '',
      root: '',
      source: '',
    };
    this.fullDebugMode = false;
    this.sleepTimer = 0;
    this.gitignore = [];
    this.branchToCheckout = '';
  }
}
