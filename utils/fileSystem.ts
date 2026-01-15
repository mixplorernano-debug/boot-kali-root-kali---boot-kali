
interface File {
    type: 'file';
    content: string;
}

interface Directory {
    type: 'directory';
    children: { [key: string]: File | Directory };
}

type FileSystemNode = File | Directory;

const chrootScriptContent = `#!/bin/python3

# Usage:
# cd in to the rootfs directory
# ./chroot.py chroot
# You will be prompted for your password to mount container paths
# At the end you should be inside the chroot

from enum import Enum
import sys
from dataclasses import dataclass, field
import subprocess
import shutil
import logging
import os
import pwd
import platform

logger = logging.getLogger()
logger.setLevel(logging.INFO)

class Command(Enum):
    UNBREAK = 0
    BREAK = 1
    CHROOT = 2

RequireProgramsForChrooting_Arm64 = [
    "FEX",
    "FEXServer",
]

@dataclass
class HostApplicationsClass:
    RequiredHostApplications = [
        "sudo",
        "mount",
        "umount",
        "mountpoint",
    ]

    RequiredHostApplications_Arm64 = [
        "patchelf",
        "readelf",
        "ldd",
    ]

    RequireProgramsForChrooting = [
        "chroot",
    ]

    def CheckIfProgramWorks(self, Program):
        from shutil import which
        if which(Program) is None:
            logging.critical("Host program '{}' isn't available and is required!".format(Program))
            sys.exit(1)

    def CheckProgramsExist(self, ExecutionCommand):
        for Program in self.RequiredHostApplications:
            self.CheckIfProgramWorks(Program)

        if not platform.machine() == "x86_64":
            for Program in self.RequiredHostApplications_Arm64:
                self.CheckIfProgramWorks(Program)

        if ExecutionCommand == Command.CHROOT:
            for Program in self.RequireProgramsForChrooting:
                self.CheckIfProgramWorks(Program)

        if not platform.machine() == "x86_64":
            for Program in RequireProgramsForChrooting_Arm64:
                self.CheckIfProgramWorks(Program)

@dataclass
class FEXInterpreterDependenciesClass:
    ProgramPaths: list
    Depends: set
    Interpreter: str
    FEXInstalled: bool

    def __init__(self):
        from shutil import which
        self.ProgramPaths = []
        self.FEXInstalled = True

        for Program in RequireProgramsForChrooting_Arm64:
            AbsPath = which(Program)
            if AbsPath is not None:
                self.ProgramPaths.append(AbsPath)
            else:
                self.FEXInstalled = False

        self.Depends = set()
        self.Interpreter = None

        if platform.machine() == "x86_64":
            self.FEXInstalled = False
            logging.info("Skipping FEXInterpreter dependencies because host is x86_64")
            return

        if not self.FEXInstalled:
            logging.info("FEX not installed. This chroot may not work!")
            return

        self.GetDepends()
        self.GetProgramInterpreter()

    def GetFEXInstalled(self):
        return self.FEXInstalled

    # Extracts shared library dependencies from FEXInterpreter
    def GetDepends(self):
        if not self.FEXInstalled:
            return

        for Path in self.ProgramPaths:
            Output = subprocess.check_output(["ldd", Path])
            # Convert byte object to string
            Output = Output.decode('ascii')

            for Line in Output.split('\\n'):
                Line = Line.strip()

                # Skip vdso dependency
                if "vdso" in Line or len(Line) == 0:
                    continue

                if " => " in Line:
                    # Split paths to get filesystem path if exists.
                    Split = Line.split(" => ")
                    assert len(Split) == 2
                    Line = Split[1]

                # Line is now in the format of '<Path> (Address)'
                # Split again to get only the library path.
                Split = Line.split(" (0x")
                assert len(Split) == 2

                Depend = Split[0]

                logging.debug("Depends: '{}' -> '{}'".format(Line, Depend))
                self.Depends.add(Depend)

    # Gets the interpreter path for FEXInterpreter .
    def GetProgramInterpreter(self):
        if not self.FEXInstalled:
            return

        for Path in self.ProgramPaths:
            Output = subprocess.check_output(["readelf", "-l", Path])
            # Convert byte object to string
            Output = Output.decode('ascii')

            for Line in Output.split('\\n'):
                Line = Line.strip()
                if "Requesting program interpreter" not in Line:
                    continue
                Split = Line.split("[Requesting program interpreter: ")
                assert len(Split) == 2

                Line = Split[1]

                # Strip off the final ']'
                Line = Line[0:(len(Line)-1)]
                logging.debug("PT_INTERP: '{}'".format(Line))
                self.Interpreter = Line

                # Remove interpreter from list of depends
                # We'll handle that manually
                self.Depends.discard(self.Interpreter)

    def CopyDependsTo(self, Path):
        if not self.FEXInstalled:
            return

        for File in self.Depends:
            logging.debug("Copying '{}' -> '{}'".format(File, Path))
            shutil.copy(File, Path)

        shutil.copy(self.Interpreter, Path)

    def CopyFEXInterpreterTo(self, DestPath):
        if not self.FEXInstalled:
            return

        for Path in self.ProgramPaths:
            shutil.copy(Path, DestPath)

    def PatchDependencies(self, ScriptPath, BinPath, LibPath):
        logging.info("Patching FEX dependencies")

        for Program in RequireProgramsForChrooting_Arm64:
            logger.debug("Patching paths for: '{}'".format(Program))

            AbsPath = "{}/{}/{}".format(ScriptPath, BinPath, Program)

            # Change interpreter path and add an rpath to search for the binaries.
            Result = subprocess.run(["patchelf", "--set-interpreter",
                                     "{}/{}".format(LibPath, os.path.basename(self.Interpreter)), AbsPath])
            assert Result.returncode == 0

            # Add the new RPATH to the FEXInterpreter
            Result = subprocess.run(["patchelf", "--add-rpath", LibPath, AbsPath])
            assert Result.returncode == 0

        logging.debug("Patching dependencies")

        for Depend in self.Depends:
            logger.debug("Patching paths for: '{}'".format(Depend))

            AbsPath = "{}/{}/{}".format(ScriptPath, LibPath, os.path.basename(Depend))

            Result = subprocess.run(["patchelf", "--add-rpath", LibPath, AbsPath])
            assert Result.returncode == 0

@dataclass
class BackupPathsClass:
    # Recursively create these folders
    CreateBackupFolders = [
        "etc/",
        "var/cache/",
        "var/lib/",
        "var/lib/dbus/",
    ]

    # Entire folders to move
    BackupFoldersToMove = [
        "boot",
        "home",
        "media",
        "mnt",
        "root",
        "srv",
        "tmp",
        "run",
        # Var folders to move
        "var/tmp",
        "var/run",
        "var/lock",
    ]

    # Folders to move only if they are empty
    BackupFoldersToMoveIfEmpty = [
        # Specifically works around wine installing things in to /opt
        "opt",
    ]

    # Files to move out of folders
    BackupFilesToMove = [
        # Bunch of etc files to move
        "etc/hosts",
        "etc/resolv.conf",
        "etc/timezone",
        "etc/localtime",
        "etc/passwd",
        "etc/passwd-",
        "etc/group",
        "etc/group-",
        "etc/shadow",
        "etc/shadow-",
        "etc/gshadow",
        "etc/gshadow-",
        "etc/fstab",
        "etc/hostname",
        "etc/mtab",
        "etc/subuid",
        "etc/subgid",
        "etc/machine-id",

        # Var files to move
        "var/lib/dbus/machine-id",
    ]

    def __init__(self):
        return

    def BackupBreak(self, BackupPath, ScriptPath):
        # Create backup folder itself
        try:
            os.makedirs(BackupPath)
        except:
            # Non-fatal
            pass

        # First create folders required.
        for Dir in self.CreateBackupFolders:
            os.makedirs("{}/{}".format(BackupPath, Dir), exist_ok=True)

        # Move folders first
        for Dir in self.BackupFoldersToMove:
            FullScriptPath = "{}/{}".format(ScriptPath, Dir)
            FullBackupPath = "{}/{}".format(BackupPath, Dir)
            # Source, Dest
            try:
                shutil.move(FullScriptPath, FullBackupPath)
            except:
                # Non-fatal
                pass

        # Move folders if only their contents are empty.
        for Dir in self.BackupFoldersToMoveIfEmpty:
            FullScriptPath = "{}/{}".format(ScriptPath, Dir)
            FullBackupPath = "{}/{}".format(BackupPath, Dir)

            try:
                listing = os.listdir(FullScriptPath)
                if len(listing) == 0:
                    # Source, Dest
                    shutil.move(FullScriptPath, FullBackupPath)
            except:
                # Non-fatal
                pass

        # Move files now
        for File in self.BackupFilesToMove:
            FullScriptPath = "{}/{}".format(ScriptPath, File)
            FullBackupPath = "{}/{}".format(BackupPath, File)
            # Source, Dest
            try:
                shutil.move(FullScriptPath, FullBackupPath)
            except:
                # Non-fatal
                pass

    def BackupUnbreak(self, BackupPath, ScriptPath):
        # Move files now
        for File in self.BackupFilesToMove:
            FullScriptPath = "{}/{}".format(ScriptPath, File)
            FullBackupPath = "{}/{}".format(BackupPath, File)
            # Source, Dest
            try:
                shutil.move(FullBackupPath, FullScriptPath)
            except:
                # Non-fatal
                pass

        # Move folders if only their contents are empty.
        for Dir in self.BackupFoldersToMoveIfEmpty:
            FullScriptPath = "{}/{}".format(ScriptPath, Dir)
            FullBackupPath = "{}/{}".format(BackupPath, Dir)

            try:
                listing = os.listdir(FullScriptPath)
                if len(listing) == 0:
                    # Source, Dest
                    shutil.move(FullBackupPath, FullScriptPath)
            except:
                # Non-fatal
                pass

        # Move folders
        for Dir in self.BackupFoldersToMove:
            FullScriptPath = "{}/{}".format(ScriptPath, Dir)
            FullBackupPath = "{}/{}".format(BackupPath, Dir)
            # Source, Dest
            try:
                shutil.move(FullBackupPath, FullScriptPath)
            except:
                # Non-fatal
                pass

        # Now remove folders
        for Dir in self.CreateBackupFolders:
            try:
                shutil.rmtree("{}/{}".format(BackupPath, Dir))
            except:
                # Non-fatal
                pass


        # Remove backup folder itself
        try:
            shutil.rmtree(BackupPath)
        except:
            # Non-fatal
            pass

@dataclass
class MountManagerClass:
    MountPaths = [
        # mntpoint, [Mount options]
        ["proc",    ["-t", "proc", "proc"]],
        ["sys",     ["-t", "sysfs", "sysfs"]],
        ["dev",     ["-t", "devtmpfs", "udev"]],
        ["dev/pts", ["-t", "devpts", "devpts"]],
        ["tmp",     ["--rbind", "/tmp"]],
    ]

    def __init__(self):
        return

    def CheckIfMountpath(self, Path):
        Result = subprocess.run(["mountpoint", "-q", Path])
        return Result.returncode == 0

    def Break(self, ScriptPath):
        logging.info("Unmounting rootfs paths")

        for Dir in reversed(self.MountPaths):
            MountPath = "{}/{}".format(ScriptPath, Dir[0])
            assert self.CheckIfMountpath(MountPath) == True

            MountOptions = ["sudo", "umount"]
            MountOptions.append(MountPath)
            Result = subprocess.run(MountOptions)
            if not Result.returncode == 0:
                logging.error("Failed to unmount {}/{}!".format(ScriptPath, Dir[0]))

        # Remove the directories now
        for Dir in reversed(self.MountPaths):
            os.rmdir("{}/{}".format(ScriptPath, Dir[0]))

    def Unbreak(self, ScriptPath):
        for Dir in self.MountPaths:
            MountPath = "{}/{}".format(ScriptPath, Dir[0])
            if self.CheckIfMountpath(MountPath):
                # Critical failure, stale mount encountered.
                logging.critical("Stale mount found at '{}'! Can't continue, early exiting".format(MountPath))
                sys.exit(1)

        # First create folders required.
        for Dir in self.MountPaths:
            os.makedirs("{}/{}".format(ScriptPath, Dir[0]), exist_ok=True)

        # For some reason /tmp ends up being 0664
        assert self.CheckIfMountpath("{}/tmp".format(ScriptPath)) == False
        Result = subprocess.run(["chmod", "1777", "{}/tmp".format(ScriptPath)])
        assert Result.returncode == 0

        logging.info("Mounting rootfs paths")

        for Dir in self.MountPaths:
            MountPath = "{}/{}".format(ScriptPath, Dir[0])

            MountOptions = ["sudo", "mount"]
            MountOptions.extend(Dir[1])
            MountOptions.append(MountPath)
            Result = subprocess.run(MountOptions)
            assert Result.returncode == 0

ScriptPath = None
FEXInterpreterDependencies = None
ExecutionCommand = None

def GetScriptPath():
    global ScriptPath
    ScriptPath = os.path.abspath(os.path.dirname(sys.argv[0]))

def DoBreak():
    logging.info("Deleting FEX paths")

    FEXPath = "{}/fex/".format(ScriptPath)
    BackupPath = "{}/chroot/".format(ScriptPath)
    try:
        shutil.rmtree(FEXPath)
    except:
        # Non-fatal
        pass

    logging.info("Unmount rootfs paths")

    Result = subprocess.run(["sudo", "umount", "-l", "{}/proc".format(ScriptPath)])

    if Result.returncode != 0:
        logging.info("Failed to umount {}/proc. Might have dangling mount!".format(ScriptPath))

    Result = subprocess.run(["sudo", "umount", "-l", "{}/sys".format(ScriptPath)])
    if Result.returncode != 0:
        logging.info("Failed to umount {}/sys. Might have dangling mount!".format(ScriptPath))

    Result = subprocess.run(["sudo", "umount", "-l", "{}/dev/pts".format(ScriptPath)])
    if Result.returncode != 0:
        logging.info("Failed to umount {}/dev/pts. Might have dangling mount!".format(ScriptPath))

    Result = subprocess.run(["sudo", "umount", "-l", "{}/dev".format(ScriptPath)])
    if Result.returncode != 0:
        logging.info("Failed to umount {}/dev. Might have dangling mount!".format(ScriptPath))

    Result = subprocess.run(["sudo", "umount", "-l", "{}/tmp".format(ScriptPath)])
    if Result.returncode != 0:
        logging.info("Failed to umount {}/tmp. Might have dangling mount!".format(ScriptPath))

    # Break the rootfs image
    BackupPathsClass().BackupBreak(BackupPath, ScriptPath)

    logging.info("Fixing any potential permission issues")

    User = pwd.getpwuid(os.getuid())[0]
    if "SUDO_USER" in os.environ:
        # If executed under sudo then user that user instead.
        User = os.environ["SUDO_USER"]

    FoldersToFix = [
        "bin",
        "chroot",
        "etc",
        "lib",
        "lib64",
        "sbin",
        "usr",
        "var",
    ]

    for Dir in FoldersToFix:
        Result = subprocess.run(["sudo", "chown", "-R", "{}:{}".format(User, User), "{}/{}".format(ScriptPath, Dir)])

    FoldersToDelete = [
        "dev/pts",
        "dev/",
        "proc/",
        "sys/",
        "usr/share/fex-emu/",

        # Ubuntu/Debian specific folder. Causes Steam some non-fatal error logs if exists
        "var/cache/apt/",
    ]
    for Dir in FoldersToDelete:
        ScriptDir = "{}/{}".format(ScriptPath, Dir)
        if MountManagerClass().CheckIfMountpath(ScriptDir):
            logging.info("{} is still a mount path! Dangling folder can break rootfs image!".format(Dir))
            continue

        if os.path.exists(ScriptDir):
            try:
                shutil.rmtree(ScriptDir)
            except:
                # Non-fatal, but fatal to run rootfs with FEX later
                logging.info("{} couldn't be removed! Dangling folder can break rootfs image!".format(Dir))
                pass

    return 0

def DoUnbreak():
    FEXInterpreterDependencies = FEXInterpreterDependenciesClass()

    logging.info("Creating FEX paths")
    LibPath = "{}/fex/lib64/".format(ScriptPath)
    BinPath = "{}/fex/bin/".format(ScriptPath)
    BackupPath = "{}/chroot/".format(ScriptPath)

    if FEXInterpreterDependencies.GetFEXInstalled():
        # Create directories that FEXInterpreter needs.
        # Continue on error, probably already existed.
        try:
            os.mkdir("{}/fex/".format(ScriptPath))
        except:
            pass

        try:
            os.mkdir(BinPath)
        except:
            pass

        try:
            os.mkdir(LibPath)
        except:
            pass

        # Copy necessary dependencies over to directories
        logging.info("Copying FEXInterpreter depends")
        FEXInterpreterDependencies.CopyDependsTo(LibPath)
        FEXInterpreterDependencies.CopyFEXInterpreterTo(BinPath)
        FEXInterpreterDependencies.PatchDependencies(ScriptPath, "/fex/bin", "/fex/lib64")

    # Unbreak the rootfs image
    BackupPathsClass().BackupUnbreak(BackupPath, ScriptPath)

    # Setup mounts
    MountManagerClass().Unbreak(ScriptPath)
    return 0

def main():
    if len(sys.argv) < 2:
        logging.error("Usage: {} <command>".format(sys.argv[0]))
        return 1

    if sys.argv[1] == "break":
        ExecutionCommand = Command.BREAK
    elif sys.argv[1] == "unbreak":
        ExecutionCommand = Command.UNBREAK
    elif sys.argv[1] == "chroot":
        ExecutionCommand = Command.CHROOT
    else:
        logging.error("Unknown command '{}'. Only understand break, unbreak, & chroot".format(sys.argv[1]))
        return 1

    GetScriptPath()
    HostApplicationsClass().CheckProgramsExist(ExecutionCommand)

    IsArm = platform.machine() == "aarch64" or "arm" in platform.machine()
    logging.debug("Platform: {}".format(platform.machine()))

    if ExecutionCommand == Command.UNBREAK:
        return DoUnbreak()
    elif ExecutionCommand == Command.BREAK:
        return DoBreak()
    elif ExecutionCommand == Command.CHROOT:
        DoUnbreak()

        if IsArm:
            logging.info("Setting up FEXServer config")

            # We need to setup FEXServer to work correctly.
            # Set up the server socketpath
            ScriptDir = os.path.dirname(ScriptPath)
            uid = os.getuid()
            SocketPath = "/usr/share/fex-emu/{}.chroot".format(uid)

            # Set FEX config for server socket path
            os.makedirs("{}/usr/share/fex-emu/".format(ScriptPath), exist_ok=True)
            Config = open("{}/usr/share/fex-emu/Config.json".format(ScriptPath), "w")
            ConfigText = "{\\"Config\\": {\\"ServerSocketPath\\":\\"{}\\"} }}".format(SocketPath)
            Config.write(ConfigText)
            Config.close()

            # Set environment file for fex server path
            Config = open("{}/etc/environment".format(ScriptPath), "a")
            Config.close()

        logging.info("Chrooting in to {}".format(ScriptPath))

        ChrootArgs = ["sudo", "chroot", ScriptPath]

        if IsArm:
            ChrootArgs.append("/fex/bin/FEX")

        ChrootArgs.append(os.environ['SHELL'])
        ChrootArgs.append("-i")
        Result = subprocess.run(ChrootArgs)

        logging.info("Returning from chroot")

        DoBreak()

    return 0

if __name__ == "__main__":
    sys.exit(main())
`;

const cyberpunkKeyboardLayoutContent = `<?xml version="1.0" encoding="UTF-8"?>
<keyboard_layout name="Cyberpunk_QWERTY_US" theme="Cyberpunk" version="1.0">
  <description>A standard US QWERTY keyboard layout with a futuristic, cyberpunk aesthetic. Key codes are based on web standards.</description>
  
  <!-- Number Row -->
  <row id="0">
    <key code="Backquote" char="\`" shift_char="~" style="accent" />
    <key code="Digit1" char="1" shift_char="!" />
    <key code="Digit2" char="2" shift_char="@" />
    <key code="Digit3" char="3" shift_char="#" />
    <key code="Digit4" char="4" shift_char="$" />
    <key code="Digit5" char="5" shift_char="%" />
    <key code="Digit6" char="6" shift_char="^" />
    <key code="Digit7" char="7" shift_char="&amp;" />
    <key code="Digit8" char="8" shift_char="*" />
    <key code="Digit9" char="9" shift_char="(" />
    <key code="Digit0" char="0" shift_char=")" />
    <key code="Minus" char="-" shift_char="_" />
    <key code="Equal" char="=" shift_char="+" />
    <key code="Backspace" char="Backspace" special="true" style="function" width="2.0" />
  </row>
  
  <!-- Top Letter Row (QWERTY) -->
  <row id="1">
    <key code="Tab" char="Tab" special="true" style="function" width="1.5" />
    <key code="KeyQ" char="q" shift_char="Q" />
    <key code="KeyW" char="w" shift_char="W" />
    <key code="KeyE" char="e" shift_char="E" />
    <key code="KeyR" char="r" shift_char="R" />
    <key code="KeyT" char="t" shift_char="T" />
    <key code="KeyY" char="y" shift_char="Y" />
    <key code="KeyU" char="u" shift_char="U" />
    <key code="KeyI" char="i" shift_char="I" />
    <key code="KeyO" char="o" shift_char="O" />
    <key code="KeyP" char="p" shift_char="P" />
    <key code="BracketLeft" char="[" shift_char="{" />
    <key code="BracketRight" char="]" shift_char="}" />
    <key code="Backslash" char="\\" shift_char="|" style="accent" width="1.5" />
  </row>
  
  <!-- Home Row -->
  <row id="2">
    <key code="CapsLock" char="Caps Lock" special="true" style="function" width="1.75" />
    <key code="KeyA" char="a" shift_char="A" />
    <key code="KeyS" char="s" shift_char="S" />
    <key code="KeyD" char="d" shift_char="D" />
    <key code="KeyF" char="f" shift_char="F" />
    <key code="KeyG" char="g" shift_char="G" />
    <key code="KeyH" char="h" shift_char="H" />
    <key code="KeyJ" char="j" shift_char="J" />
    <key code="KeyK" char="k" shift_char="K" />
    <key code="KeyL" char="l" shift_char="L" />
    <key code="Semicolon" char=";" shift_char=":" />
    <key code="Quote" char="'" shift_char="&quot;" />
    <key code="Enter" char="Enter" special="true" style="function" width="2.25" />
  </row>
  
  <!-- Bottom Letter Row -->
  <row id="3">
    <key code="ShiftLeft" char="Shift" special="true" style="function" width="2.25" />
    <key code="KeyZ" char="z" shift_char="Z" />
    <key code="KeyX" char="x" shift_char="X" />
    <key code="KeyC" char="c" shift_char="C" />
    <key code="KeyV" char="v" shift_char="V" />
    <key code="KeyB" char="b" shift_char="B" />
    <key code="KeyN" char="n" shift_char="N" />
    <key code="KeyM" char="m" shift_char="M" />
    <key code="Comma" char="," shift_char="&lt;" />
    <key code="Period" char="." shift_char="&gt;" />
    <key code="Slash" char="/" shift_char="?" />
    <key code="ShiftRight" char="Shift" special="true" style="function" width="2.75" />
  </row>
  
  <!-- Spacebar Row -->
  <row id="4">
    <key code="ControlLeft" char="Ctrl" special="true" style="function" width="1.25" />
    <key code="MetaLeft" char="Meta" special="true" style="function" width="1.25" />
    <key code="AltLeft" char="Alt" special="true" style="function" width="1.25" />
    <key code="Space" char=" " special="false" width="6.25" style="spacebar" />
    <key code="AltRight" char="Alt" special="true" style="function" width="1.25" />
    <key code="MetaRight" char="Meta" special="true" style="function" width="1.25" />
    <key code="ContextMenu" char="Menu" special="true" style="function" width="1.25" />
    <key code="ControlRight" char="Ctrl" special="true" style="function" width="1.25" />
  </row>
</keyboard_layout>`;

const fileSystem: Directory = {
    type: 'directory',
    children: {
        home: {
            type: 'directory',
            children: {
                kali: {
                    type: 'directory',
                    children: {
                        'README.md': {
                            type: 'file',
                            content: 'Welcome to the Kali Linux command simulator!\n\n- Use `ls` to see files and directories.\n- Use `cd` to navigate.\n- Try `cat README.md` to see this file\'s content.\n- Type `help` for a full list of commands.',
                        },
                        'chroot.py': {
                            type: 'file',
                            content: chrootScriptContent,
                        },
                        'Cyberpunk_QWERTY_(US).xml': {
                            type: 'file',
                            content: cyberpunkKeyboardLayoutContent,
                        },
                        documents: {
                            type: 'directory',
                            children: {
                                'project_plan.txt': {
                                    type: 'file',
                                    content: 'Phase 1: Initial setup.\nPhase 2: Core feature implementation.\nPhase 3: Launch.',
                                },
                            },
                        },
                        projects: {
                            type: 'directory',
                            children: {
                                'website': {
                                    type: 'directory',
                                    children: {
                                        'index.html': { type: 'file', content: '<h1>Hello, World!</h1>' },
                                        'style.css': { type: 'file', content: 'body { color: green; }' },
                                    },
                                },
                            },
                        },
                        '.secret_file': {
                            type: 'file',
                            content: 'This is a hidden file. You found it!',
                        },
                    },
                },
            },
        },
    },
};

function resolvePath(cwd: string, path: string): string {
    if (path.startsWith('/')) {
        // Absolute path
        cwd = '/';
    } else if (path === '~') {
        return '/home/kali';
    }

    const parts = path.split('/').filter(p => p);
    let currentParts = cwd === '/' ? [] : cwd.split('/').filter(p => p);
    
    for (const part of parts) {
        if (part === '.') {
            continue;
        }
        if (part === '..') {
            currentParts.pop();
        } else {
            currentParts.push(part);
        }
    }
    
    return '/' + currentParts.join('/');
}

export function getNode(path: string): FileSystemNode | null {
    const parts = path.split('/').filter(p => p);
    let currentNode: FileSystemNode = fileSystem;

    for (const part of parts) {
        if (currentNode.type !== 'directory') {
            return null;
        }
        const nextNode = currentNode.children[part];
        if (!nextNode) {
            return null;
        }
        currentNode = nextNode;
    }

    return currentNode;
}

export function createClonedDirectory(cwd: string, repoName: string): boolean {
    const parentPath = cwd;
    const parentNode = getNode(parentPath) as Directory;

    if (parentNode && parentNode.type === 'directory') {
        if (parentNode.children[repoName]) {
            return false; // Should be checked before calling
        }
        parentNode.children[repoName] = {
            type: 'directory',
            children: {
                '.git': {
                    type: 'directory',
                    children: {},
                },
                'README.md': {
                    type: 'file',
                    content: `# ${repoName}\n\nA repository cloned with the simulator.`,
                },
                'src': {
                    type: 'directory',
                    children: {
                        'main.js': {
                            type: 'file',
                            content: 'console.log("Hello, World!");',
                        },
                    },
                },
            },
        };
        return true;
    }
    return false;
}


export function handleFileSystemCommand(fullCommand: string, cwd: string, setCwd: (path: string) => void): string | null {
    const [command, ...args] = fullCommand.split(/\s+/);
    
    switch (command.toLowerCase()) {
        case 'pwd':
            return cwd;

        case 'cd': {
            const target = args[0] || '/home/kali';
            const newPath = resolvePath(cwd, target);
            const node = getNode(newPath);
            if (node && node.type === 'directory') {
                setCwd(newPath);
                return ''; // No output for successful cd
            } else {
                return `cd: no such file or directory: ${target}`;
            }
        }
            
        case 'ls': {
            const node = getNode(cwd);
            if (node && node.type === 'directory') {
                let items = Object.keys(node.children);
                const showAll = args.includes('-a');
                if (!showAll) {
                    items = items.filter(item => !item.startsWith('.'));
                }
                return items.map(item => {
                    return node.children[item].type === 'directory' ? `${item}/` : item;
                }).join('\n');
            }
            return 'ls: cannot access '.concat(cwd, ': No such file or directory');
        }

        case 'cat': {
            if (!args[0]) {
                return 'cat: missing operand';
            }
            const path = resolvePath(cwd, args[0]);
            const node = getNode(path);
            if (node) {
                if (node.type === 'file') {
                    return node.content;
                } else {
                    return `cat: ${args[0]}: Is a directory`;
                }
            } else {
                return `cat: ${args[0]}: No such file or directory`;
            }
        }
        
        case 'mkdir': {
            const targetPath = args[0];
            if (!targetPath) {
                return 'mkdir: missing operand';
            }
            
            const fullPath = resolvePath(cwd, targetPath);
            
            const nodeExists = getNode(fullPath);
            if (nodeExists) {
                return `mkdir: cannot create directory ‘${targetPath}’: File exists`;
            }
        
            const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/')) || '/';
            const newDirName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
        
            if (!newDirName) {
                return `mkdir: cannot create directory ‘${targetPath}’: Invalid argument`;
            }
        
            const parentNode = getNode(parentPath);
        
            if (parentNode && parentNode.type === 'directory') {
                parentNode.children[newDirName] = {
                    type: 'directory',
                    children: {}
                };
                return ''; // Success
            } else {
                return `mkdir: cannot create directory ‘${targetPath}’: No such file or directory`;
            }
        }

        case 'whoami':
            return 'kali';
            
        case 'termux-fix-shebang': {
            const fileName = args[0];
            if (!fileName) {
                return 'usage: termux-fix-shebang <file>';
            }

            const path = resolvePath(cwd, fileName);
            const node = getNode(path);

            if (!node) {
                return `termux-fix-shebang: file not found: ${fileName}`;
            }

            if (node.type !== 'file') {
                return `termux-fix-shebang: not a file: ${fileName}`;
            }

            const lines = node.content.split('\\n');
            if (lines.length > 0 && lines[0].startsWith('#!')) {
                const oldShebang = lines[0];
                lines[0] = '#!/data/data/com.termux/files/usr/bin/python3';
                node.content = lines.join('\\n');
                return `shebang of ${fileName} has been rewritten from '${oldShebang}' to '${lines[0]}'`;
            } else {
                return `${fileName} does not have a shebang or is empty.`;
            }
        }

        default:
            return null; // Not a filesystem command
    }
}
