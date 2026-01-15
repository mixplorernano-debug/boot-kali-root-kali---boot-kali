
import React, { useState, useEffect, useRef } from 'react';
import type { HistoryItem } from '../types';

interface TerminalProps {
  history: HistoryItem[];
  onCommand: (command: string) => void;
  isLoading: boolean;
  onAutocompleteSuggestions: (command: string, suggestions: string[]) => void;
  cwd: string;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  promptFormat: string;
  isSettingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onUpdatePrompt: (format: string) => void;
}

const SunIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const MoonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
  </svg>
);

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const SettingsModal = ({ format, onSave, onCancel }: { format: string, onSave: (format: string) => void, onCancel: () => void }) => {
  const [currentFormat, setCurrentFormat] = useState(format);

  const handleSave = () => {
    onSave(currentFormat);
  };

  return (
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-10 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl w-full max-w-md text-gray-900 dark:text-gray-100">
        <h2 className="text-xl font-bold mb-4">Customize Prompt</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Use variables to build your prompt string:
        </p>
        <ul className="text-xs list-disc list-inside mb-4 bg-gray-100 dark:bg-gray-700 p-3 rounded-md space-y-1">
          <li><code>%u</code>: username (e.g., kali)</li>
          <li><code>%h</code>: hostname (e.g., kali)</li>
          <li><code>%w</code>: full working directory (e.g., ~/projects)</li>
          <li><code>%W</code>: basename of directory (e.g., projects)</li>
          <li><code>%$</code>: prompt symbol ($)</li>
        </ul>
        <input
          type="text"
          value={currentFormat}
          onChange={(e) => setCurrentFormat(e.target.value)}
          className="w-full bg-gray-200 dark:bg-gray-900 rounded p-2 font-mono text-sm border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="Prompt format input"
        />
        <div className="flex justify-end gap-4 mt-6">
          <button onClick={onCancel} className="px-4 py-2 rounded bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
};

const commands = [
  'ls', 'pwd', 'whoami', 'neofetch', 'apt update',
  'apt install', 'ping', 'help', 'clear', 'cd', 'cat', 'mkdir',
  'git status', 'git log', 'git clone', 'git push', 'git pull', 'git branch', 'git commit', 'git diff', 'git fetch',
  'termux-fix-shebang'
];

const Terminal: React.FC<TerminalProps> = ({ history, onCommand, isLoading, onAutocompleteSuggestions, cwd, theme, toggleTheme, promptFormat, isSettingsOpen, onOpenSettings, onCloseSettings, onUpdatePrompt }) => {
  const [input, setInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commandHistory = useRef<string[]>([]);
  const searchIndex = useRef<number>(0);

  useEffect(() => {
    commandHistory.current = history
      .filter(item => item.type === 'command')
      .map(item => item.content);
  }, [history]);

  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [history, searchQuery]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isSearching) return;
    setInput(e.target.value);
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading) return;
    
    if (isSearching) {
      exitSearchMode();
    }
    
    onCommand(input);
    setInput('');
  };

  const handleClick = () => {
    inputRef.current?.focus();
  };

  const exitSearchMode = () => {
    setIsSearching(false);
    setSearchQuery('');
  };

  const performSearch = (query: string, startIndex: number) => {
    if (!query) {
      setInput('');
      return;
    }
    for (let i = startIndex - 1; i >= 0; i--) {
      if (commandHistory.current[i].includes(query)) {
        setInput(commandHistory.current[i]);
        searchIndex.current = i;
        return;
      }
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isSearching) {
      e.preventDefault();

      if (e.ctrlKey && e.key === 'r') {
        performSearch(searchQuery, searchIndex.current);
      } else if (e.key === 'Backspace') {
        const newQuery = searchQuery.slice(0, -1);
        setSearchQuery(newQuery);
        searchIndex.current = commandHistory.current.length;
        performSearch(newQuery, commandHistory.current.length);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const newQuery = searchQuery + e.key;
        setSearchQuery(newQuery);
        searchIndex.current = commandHistory.current.length;
        performSearch(newQuery, commandHistory.current.length);
      } else if (e.key === 'Escape' || e.key.startsWith('Arrow')) {
        exitSearchMode();
      } else if (e.key === 'Enter') {
        exitSearchMode();
      }
      return;
    }

    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      setIsSearching(true);
      setSearchQuery('');
      setInput('');
      searchIndex.current = commandHistory.current.length;
      return;
    }
    
    if (e.key === 'Tab') {
      e.preventDefault();
      const trimmedInput = input.trim();
      if (!trimmedInput) return;

      const matches = commands.filter(cmd => cmd.startsWith(trimmedInput));

      if (matches.length === 1) {
        setInput(matches[0] + ' ');
      } else if (matches.length > 1) {
        onAutocompleteSuggestions(input, matches);
      }
    }
  };
  
  const parsePromptFormat = (path: string) => {
    const basename = path === '/home/kali' ? '~' : path.split('/').pop() || '/';
    return promptFormat
      .replace(/%u/g, 'kali')
      .replace(/%h/g, 'kali')
      .replace(/%w/g, path.replace(/^\/home\/kali/, '~'))
      .replace(/%W/g, basename)
      .replace(/%\$/g, '$');
  };

  const renderPrompt = () => {
    if (isSearching) {
      return `(reverse-i-search)\`${searchQuery}\`: `;
    }
    return parsePromptFormat(cwd);
  }
  
  const renderCommandPrompt = (command: string) => {
      // Simplification: always show current prompt format for past commands.
      return parsePromptFormat(cwd);
  }

  const renderOutputContent = (content: string) => {
    if (content.startsWith('commit ')) { // Check for git log output
      return (
        <pre className="whitespace-pre-wrap">
          {content.split('\n').map((line, i) => {
            if (line.startsWith('commit ')) {
              const parts = line.split(' ');
              const commitHash = parts[1];
              const restOfLine = parts.slice(2).join(' ');
              return (
                <span key={i}>
                  <span className="text-gray-700 dark:text-green-400">commit </span>
                  <span className="text-yellow-500 dark:text-yellow-400">{commitHash}</span>
                  {restOfLine && <span className="text-cyan-500 dark:text-cyan-400"> {restOfLine}</span>}
                  {'\n'}
                </span>
              );
            }
            if (line.startsWith('    ')) { // Commit message
              return <span key={i} className="text-gray-900 dark:text-gray-100">{line}{'\n'}</span>;
            }
            // Author, Date, and other lines
            return <span key={i} className="text-gray-700 dark:text-green-400">{line}{'\n'}</span>;
          })}
        </pre>
      );
    }
    if (content.startsWith('diff --git')) {
      return (
        <pre className="whitespace-pre-wrap">
          {content.split('\n').map((line, i) => {
            let colorClass = 'text-gray-700 dark:text-green-400'; // Default
            if (line.startsWith('+') && !line.startsWith('+++')) colorClass = 'text-green-600 dark:text-green-500';
            if (line.startsWith('-') && !line.startsWith('---')) colorClass = 'text-red-600 dark:text-red-500';
            if (line.startsWith('@@')) colorClass = 'text-cyan-600 dark:text-cyan-400';
            if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('index')) {
              colorClass = 'font-bold text-gray-800 dark:text-gray-200';
            }
            
            return <span key={i} className={colorClass}>{line}{'\n'}</span>;
          })}
        </pre>
      );
    }
    return <pre className="whitespace-pre-wrap text-gray-700 dark:text-green-400">{content}</pre>;
  };

  return (
    <div 
      className="relative w-full h-full bg-white/80 dark:bg-black/80 backdrop-blur-sm rounded-lg shadow-2xl font-mono text-sm border border-gray-300 dark:border-gray-700 flex flex-col transition-colors duration-300"
      onClick={handleClick}
    >
      {isSettingsOpen && <SettingsModal format={promptFormat} onSave={onUpdatePrompt} onCancel={onCloseSettings} />}
      <div className="bg-gray-200 dark:bg-gray-800 p-2 rounded-t-lg flex items-center gap-2 transition-colors duration-300">
        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
        <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
        <div className="w-3 h-3 bg-green-500 rounded-full"></div>
        <div className="flex-grow text-center text-gray-500 dark:text-gray-400 text-xs">kali@kali: ~</div>
        <button
          onClick={onOpenSettings}
          className="text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors mr-2"
          aria-label="Open settings"
        >
          <SettingsIcon />
        </button>
        <button
          onClick={toggleTheme}
          className="text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
      <div ref={terminalBodyRef} className="flex-grow p-4 overflow-y-auto">
        {history.map((item, index) => (
          <div key={index}>
            {item.type === 'command' ? (
              <div className="flex items-center">
                <span className="text-indigo-600 dark:text-blue-400">{renderCommandPrompt(item.content)}</span>
                <span className="ml-2 text-gray-900 dark:text-gray-100">{item.content}</span>
              </div>
            ) : (
              renderOutputContent(item.content)
            )}
          </div>
        ))}
         {isLoading && (
            <div>
              <div className="flex items-center">
                 <span className="text-indigo-600 dark:text-blue-400">{renderPrompt()}</span>
                 <span className="ml-2 text-gray-900 dark:text-gray-100">{input}</span>
              </div>
              <div className="text-yellow-600 dark:text-yellow-400">Executing...</div>
            </div>
        )}
      </div>
      <div className="p-4 border-t border-gray-300 dark:border-gray-700 transition-colors duration-300">
        <form onSubmit={handleFormSubmit} className="flex items-center">
          <label htmlFor="command-input" className="text-indigo-600 dark:text-blue-400">{renderPrompt()}</label>
          <input
            ref={inputRef}
            id="command-input"
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="flex-grow bg-transparent text-gray-900 dark:text-gray-100 ml-2 focus:outline-none"
            autoFocus
            disabled={isLoading}
            autoComplete="off"
            spellCheck="false"
          />
           {!isLoading && <div className="w-2 h-4 bg-gray-700 dark:bg-green-400 animate-pulse"></div>}
        </form>
      </div>
    </div>
  );
};

export default Terminal;
