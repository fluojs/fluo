import { readdir, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';

export async function linuxListeners(pid: number) {
  const tables = await Promise.all(['tcp', 'tcp6'].map((name) => readFile(`/proc/${pid}/net/${name}`, 'utf8')));
  const directory = `/proc/${pid}/fd`;
  const descriptors = await Promise.all((await readdir(directory)).map(async (fd) => {
    try {
      return { fd, link: await readlink(join(directory, fd)) };
    } catch (error) {
      // A non-listener descriptor may close between enumeration and readlink.
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { fd, link: null };
      throw error;
    }
  }));
  const sockets = tables.flatMap((table) => table.trim().split('\n').slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[3] === '0A')
    .map((fields) => ({
      address: fields[1], port: Number.parseInt(fields[1].split(':')[1], 16), inode: fields[9],
      owned: descriptors.some(({ link }) => link === `socket:[${fields[9]}]`),
    })));
  return { method: 'procfs-listening-inodes-and-process-fds', pid, sockets, descriptors, tables };
}
