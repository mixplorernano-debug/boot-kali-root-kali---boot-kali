
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Terminal from './components/Terminal';
import { simulateCommandOutput } from './services/geminiService';
import type { HistoryItem } from './types';
import { handleFileSystemCommand, getNode, createClonedDirectory } from './utils/fileSystem';

const App: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>([
    { type: 'output', content: 'Welcome to Linux Command Simulator!' },
    { type: 'output', content: 'Type `help` for a list of commands.' },
    { type: 'output', content: '' },
  ]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [cwd, setCwd] = useState('/home/kali');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [promptFormat, setPromptFormat] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('promptFormat') || '%u@%h:%w$';
    }
    return '%u@%h:%w$';
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
      }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'light';
  });
  const initialCommandRun = useRef(false);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [theme]);
  
  const handleUpdatePrompt = (newFormat: string) => {
    setPromptFormat(newFormat);
    localStorage.setItem('promptFormat', newFormat);
    setIsSettingsOpen(false);
  };

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  const executeCommand = useCallback(async (command: string) => {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) return;

    setHistory(prev => [...prev, { type: 'command', content: trimmedCommand }]);
    setIsLoading(true);

    if (trimmedCommand.toLowerCase() === 'clear') {
      setHistory([]);
      setIsLoading(false);
      return;
    }

    if (trimmedCommand.startsWith('git clone')) {
      const repoUrl = trimmedCommand.split(/\s+/)[2];
      
      if (!repoUrl) {
        setHistory(prev => [...prev, { type: 'output', content: "fatal: You must specify a repository to clone." }]);
        setIsLoading(false);
        return;
      }

      const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'repository';
      
      if (getNode(`${cwd}/${repoName}`)) {
          setHistory(prev => [...prev, { type: 'output', content: `fatal: destination path '${repoName}' already exists and is not an empty directory.` }]);
          setIsLoading(false);
          return;
      }

      const initialOutput = `Cloning into '${repoName}'...`;
      const historyIndex = history.length + 1; // +1 for the command just added
      setHistory(prev => [...prev, { type: 'output', content: initialOutput }]);

      const progressLines = [
        'remote: Enumerating objects: 23, done.',
        'remote: Counting objects: 100% (23/23), done.',
        'remote: Compressing objects: 100% (13/13), done.',
        'remote: Total 23 (delta 5), reused 20 (delta 5), pack-reused 0',
        'Receiving objects: 100% (23/23), 4.68 KiB | 4.68 MiB/s, done.',
        'Resolving deltas: 100% (5/5), done.'
      ];

      let currentOutput = initialOutput;
      for (const line of progressLines) {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 250 + 50));
          currentOutput += `\n${line}`;
          setHistory(prev => {
              const newHistory = [...prev];
              const target = newHistory[historyIndex];
              if (target && target.type === 'output') {
                target.content = currentOutput;
              }
              return newHistory;
          });
      }
      
      createClonedDirectory(cwd, repoName);
      setIsLoading(false);
      return;
    } else if (trimmedCommand.startsWith('git commit')) {
      const commitRegex = /-m\s+"([^"]+)"|-m\s+'([^']+)'/;
      const match = trimmedCommand.match(commitRegex);

      if (!match) {
        setHistory(prev => [...prev, { type: 'output', content: "fatal: You must specify a commit message with -m \"<message>\"" }]);
        setIsLoading(false);
        return;
      }

      const message = match[1] || match[2];
      if (!message) {
         setHistory(prev => [...prev, { type: 'output', content: "fatal: commit message is empty." }]);
         setIsLoading(false);
         return;
      }

      const commitHash = Array.from({length: 7}, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      const filesChanged = Math.floor(Math.random() * 3) + 1;
      const insertions = Math.floor(Math.random() * 20) + 1;

      const output = `[main ${commitHash}] ${message}\n ${filesChanged} file changed, ${insertions} insertions(+)`;

      setHistory(prev => [...prev, { type: 'output', content: output }]);
      setIsLoading(false);
      return;
    } else if (trimmedCommand.toLowerCase() === 'git log') {
        const generateCommit = (message: string, isHead: boolean = false) => {
            const hash = Array.from({length: 40}, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
            const author = 'Kali User <kali@example.com>';
            const date = new Date(Date.now() - Math.random() * 31536000000).toUTCString();
            
            let commitLine = `commit ${hash}`;
            if (isHead) {
                commitLine += ' (HEAD -> main, origin/main)';
            }
            
            return [
                commitLine,
                `Author: ${author}`,
                `Date:   ${date}`,
                '',
                `    ${message}`
            ].join('\n');
        };

        const commitMessages = [
            "feat: Implement user authentication",
            "fix: Correct rendering issue on Firefox",
            "docs: Update README with installation instructions",
            "refactor: Simplify component logic",
            "chore: Bump dependency versions"
        ];

        const logOutput = Array.from({ length: Math.floor(Math.random() * 3) + 3 }, (_, i) => {
            const message = commitMessages[Math.floor(Math.random() * commitMessages.length)];
            return generateCommit(message, i === 0);
        }).join('\n\n');

        setHistory(prev => [...prev, { type: 'output', content: logOutput }]);
        setIsLoading(false);
        return;
    } else if (trimmedCommand.toLowerCase() === 'git diff') {
        const fictionalFiles = [
            { name: 'src/main.js', oldContent: 'console.log("Hello, World!");', newContent: 'console.log("Hello, Git!");\n+const version = "1.1";' },
            { name: 'README.md', oldContent: 'A repository cloned with the simulator.', newContent: 'A repository for the awesome simulator project.' }
        ];

        const randomFile = fictionalFiles[Math.floor(Math.random() * fictionalFiles.length)];
        const oldLinesCount = randomFile.oldContent.split('\n').length;
        const newLinesCount = randomFile.newContent.split('\n').length;
        const commitHash1 = Array.from({length: 7}, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
        const commitHash2 = Array.from({length: 7}, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
        
        const output = `diff --git a/${randomFile.name} b/${randomFile.name}
index ${commitHash1}..${commitHash2} 100644
--- a/${randomFile.name}
+++ b/${randomFile.name}
@@ -1,${oldLinesCount} +1,${newLinesCount} @@
-${randomFile.oldContent}
+${randomFile.newContent}`;
        
        setHistory(prev => [...prev, { type: 'output', content: output }]);
        setIsLoading(false);
        return;
    } else if (trimmedCommand.toLowerCase() === 'git fetch') {
        const remoteUrl = 'github.com:example/repository.git';
        const initialOutput = `Fetching origin`;
        const historyIndex = history.length + 1;
        setHistory(prev => [...prev, { type: 'output', content: initialOutput }]);

        const objectsCount = Math.floor(Math.random() * 10) + 5;
        const deltaCount = Math.floor(Math.random() * 5);
        const totalCount = objectsCount - deltaCount;

        const progressLines = [
            `remote: Enumerating objects: ${objectsCount}, done.`,
            `remote: Counting objects: 100% (${objectsCount}/${objectsCount}), done.`,
            `remote: Compressing objects: 100% (${Math.floor(objectsCount / 2)}/${Math.floor(objectsCount / 2)}), done.`,
            `remote: Total ${totalCount} (delta ${deltaCount}), reused ${totalCount} (delta ${deltaCount}), pack-reused 0`,
            `Unpacking objects: 100% (${totalCount}/${totalCount}), done.`,
            `From ${remoteUrl}`
        ];
        
        const oldHash = Array.from({length: 7}, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
        const newHash = Array.from({length: 7}, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
        const branchName = 'main';
        progressLines.push(`   ${oldHash}..${newHash}  ${branchName}       -> origin/${branchName}`);

        let currentOutput = initialOutput;
        for (const line of progressLines) {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 250 + 50));
            currentOutput += `\n${line}`;
            setHistory(prev => {
                const newHistory = [...prev];
                const target = newHistory[historyIndex];
                if (target && target.type === 'output') {
                  target.content = currentOutput;
                }
                return newHistory;
            });
        }
        
        setIsLoading(false);
        return;
    }
    
    const fileSystemOutput = handleFileSystemCommand(trimmedCommand, cwd, setCwd);

    if (fileSystemOutput !== null) {
      if (fileSystemOutput) { 
         setHistory(prev => [...prev, { type: 'output', content: fileSystemOutput }]);
      }
      setIsLoading(false);
      return;
    }

    try {
      const output = await simulateCommandOutput(trimmedCommand);
      setHistory(prev => [...prev, { type: 'output', content: output }]);
    } catch (error) {
      console.error('Error executing command:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      setHistory(prev => [...prev, { type: 'output', content: `Error: ${errorMessage}` }]);
    } finally {
      setIsLoading(false);
    }
  }, [history, cwd]);

  useEffect(() => {
    if (initialCommandRun.current) {
      return;
    }
    initialCommandRun.current = true;

    // Automatically run an initial command on load.
    const initialCommand = 'neofetch';
    const runInitialCommand = async () => {
      const initialHistory: HistoryItem[] = [
          ...history,
          { type: 'command', content: initialCommand }
      ];
      setHistory(initialHistory);
      try {
        const output = await simulateCommandOutput(initialCommand);
        setHistory(prev => [...prev, { type: 'output', content: output }]);
      } catch (error) {
        console.error('Error executing initial command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        setHistory(prev => [...prev, { type: 'output', content: `Error: ${errorMessage}` }]);
      } finally {
        setIsLoading(false);
      }
    };

    runInitialCommand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAutocompleteSuggestions = (command: string, suggestions: string[]) => {
    setHistory(prev => [
      ...prev,
      { type: 'command', content: command },
      { type: 'output', content: suggestions.join('   ') },
    ]);
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-black dark:text-white flex items-center justify-center p-4 transition-colors duration-300">
      <div className="w-full max-w-4xl h-[80vh] lg:h-[90vh]">
        <Terminal
          history={history}
          onCommand={executeCommand}
          isLoading={isLoading}
          onAutocompleteSuggestions={handleAutocompleteSuggestions}
          cwd={cwd}
          theme={theme}
          toggleTheme={toggleTheme}
          promptFormat={promptFormat}
          isSettingsOpen={isSettingsOpen}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onCloseSettings={() => setIsSettingsOpen(false)}
          onUpdatePrompt={handleUpdatePrompt}
        />
      </div>
    </div>
  );
};

export default App;
