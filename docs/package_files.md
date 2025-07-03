<!-- https://packagecontrol.io/docs/creating_package_files -->
<!-- https://github.com/wbond/packagecontrol.io/blob/master/app/html/docs/creating_package_files.html -->

# Creating Package Files

If you are developing a package, and plan on doing custom repository hosting instead of using GitHub or BitBucket, Package Control includes the command _Create Package_ to assist in creating .sublime-package files from your package directories. This command is run via the command palette, and via the settings, allows you to customize what files are included in the output package file.

## Package Profiles

Before running the _Create Package_ command, take a moment to review the various settings that control the output. Package Control ships with two profiles, Default and Binaries Only. Here are the settings the control the Default profile:

*   [dirs\_to\_ignore](/docs/settings#setting-dirs_to_ignore)
*   [files\_to\_ignore](/docs/settings#setting-files_to_ignore)
*   [files\_to\_include](/docs/settings#setting-files_to_include)
*   [package\_destination](/docs/settings#setting-package_destination)

The [package\_profiles](/docs/settings#setting-package_profiles) setting allows creating other named profiles that can override each of the settings listed above. By default, a single custom profile is included: Binaries Only. Copy the settings from Preferences _\>_ Package Settings _\>_ Package Control _\>_ Settings – Default into Preferences _\>_ Package Settings _\>_ Package Control _\>_ Settings – User and customize to suit your needs.

## Running _Create Package_

Running the _Create Package_ command will prompt you to select a package to create the package file for. Next, it will ask you to choose what package profile you would like to use. Package Control will then create a .sublime-package file, add the package files to it and place it in the package\_destination.

## .pyc Files

With Sublime Text 2, all python files are compiled into .pyc files by default by Sublime Text itself. This allows you to choose if you want to ship a binary-only package. Python 3 in Sublime Text 3 changes how Python scripts are compiled, storing them all in a \_\_pycache\_\_/ folder, which doesn’t work if you are trying to ship a binary only package.

Because of this, Package Control explicitly compiles all .py files into .pyc files, in the same directory, bypassing the \_\_pycache\_\_/ for Sublime Text 3. So, while normally Python 2 and Python 3 are quite different when it comes to .pyc files, Package Control works around the issue. Please note, however, that it will still be required to ship a different version of the package for Sublime Text 2 and Sublime Text 3 since they use different .pyc formats. This can be accomplished by running _Create Package_ from Sublime Text 2 for an ST2-compatible version of the package, and running _Create Package_ from Sublime Text 3 for an ST3-compatible version.
