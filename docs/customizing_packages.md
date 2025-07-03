<!-- https://packagecontrol.io/docs/customizing_packages -->
<!-- https://github.com/wbond/packagecontrol.io/blob/master/app/html/docs/customizing_packages.html -->

# Customizing Packages

There will frequently be situations where a package works _almost_ exactly how you want it to, however, a few small tweaks would make it perfect. Depending on what version of Sublime Text you are using and how the package is installed, you have a few different options for customizing a package.

## Packed vs. Unpacked

Sublime Text 3 offers the most options for overriding a package. By default, packages will be installed by placing a .sublime-package file in the Install Packages/ folder. Then users may override individual files in the package by creating a folder Packages/{Package Name}/ and placing edited files in there.

Unfortunately not all packages work when stored inside of a .sublime-package file. This is usually because the package includes files such as shared libraries or executables. If a developer places a file named .no-sublime-package in the root of their package, Package Control will extract the package into Packages/{Package Name}/.

Packages stored in .sublime-package files are referred to as _packed_, whereas packages extracted into a folder in Packages/ are referred to as _unpacked_. Sublime Text 2 only supports unpacked packages.

Unpacked packages can be customized via [User Package][2] or [Git/Hg Clone][3]. Packed packages may use [Overrides][4], [User Package][5] or [Git/Hg Clone][6].

## Editing Unpacked Files

Editing an unpacked package’s files is not a good idea unless you’ve cloned the package via Git/Hg. This is because, by default, Package Control will automatically upgrade packages to the newest version. This will cause any edits to files to be overwritten. If you experience this, you may wish to check out the [Backups][7] section to learn how to recover your customized version of a file.

## User Package

The Packages/User/ folder is the User package. It is unique in that it is loaded _last_ by Sublime Text. This allows users to place changes to .sublime-settings and .sublime-keymap files in this folder.

Sublime Text loads these files by name. Thus if a package has a file named Package Control.sublime-settings in the package, a file with the same name in the User package will override any of the settings in the original file. The same is true for key bindings.

## Overrides

If a package for Sublime Text 3 is installed as a packed package, it should be possible to directly override individual non-python files. To do this, create a Packages/{Package Name}/ folder and save customized versions of the files with the same name they are in the .sublime-package file.

To view the original files, you can view the repository online for packages from GitHub or BitBucket, or use a zip program to unpack the .sublime-package file.

## Git/Hg Clone

For complete customization of a package, it will likely be necessary to use a version control program, such as Git or Hg, to clone a copy of the original package repository into the Packages/ folder.

The best way to make customizations would be to fork the original repository and clone your fork of it. If you think your customizations could be useful to others, consider sending a pull request to have your changes merged into the original version.

If you’ve cloned it from your own fork of the repository, no settings need to be changed. If you clone it from the original repository, you will likely want to set the [ignore\_vcs\_packages][8] setting.

There are a number of settings that control how packages are upgraded if you have cloned a repository and not set ignore\_vcs\_packages to false. These include: [git\_binary][9], [git\_update\_command][10], [hg\_binary][11], [hg\_update\_command][12].

## Backups

If you do ever find yourself in a situation where your edits to a package were overwritten by Package Control, you can find a backup copy in the _Backup/_ folder. This folder can be located by selecting the _Preferences > Browse Packages…_ menu and then browsing up a folder. Backups are stored in timestamped folders.

[1]: /docs
[2]: #User_Package
[3]: #Git-Hg_Clone
[4]: #Overrides
[5]: #User_Package
[6]: #Git-Hg_Clone
[7]: #Backups
[8]: /docs/settings#setting-ignore_vcs_packages
[9]: /docs/settings#setting-git_binary
[10]: /docs/settings#setting-git_update_command
[11]: /docs/settings#setting-hg_binary
[12]: /docs/settings#setting-hg_update_command
