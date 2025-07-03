<!-- https://packagecontrol.io/docs/dependencies -->
<!-- https://github.com/wbond/packagecontrol.io/blob/master/app/html/docs/dependencies.html -->

# Dependencies

One of the new features of Package Control 3.0 is support for dependencies. Dependencies are non-user-visible packages that contain binaries, shared libraries or Python modules. Dependencies are not a way to install multiple related packages. Currently no such functionality exists.

## How They Work

Similar to packages, dependencies are distributed through a repository. Dependencies are always fully extracted to the user’s Packages/ folder, using their name. Thus, dependency and package names exist in a single namespace. This means you can not have a dependency with the same name as a package.

Once the package is extracted, a custom-generated python file is added to a special package named 0\_package\_control\_loader. For Sublime Text 3, this is a .sublime-package file, whereas for Sublime Text 2 it is just a folder. The reason for the name (and creating it as a .sublime-package file in ST3) is to ensure it is the very first non-default package that Sublime Text loads.

The generated python file looks for predefined subfolder names in the dependency folder, based on the user’s machine. Each matching subfolder that is found will be added to Python’s sys.path list, which is used to load modules.

The predefined subfolder names are in the formats: st{st\_version}\_{os}\_{arch}, st{st\_version}\_{os}, st{st\_version} and all. For example, with Sublime Text 3 on a 64-bit Linux machine the following subfolders will be checked:

1.  st3\_linux\_x64
2.  st3\_linux
3.  st3
4.  all

The valid list of Sublime Text versions is: st2 and st3. The valid list of operating systems is: windows, osx and linux. The valid list of architectures is: x32 and x64.

If for some reason you need different logic, create a single python file in the root folder of the dependency named loader.code. This file should contain python code and would be fully responsible for making any and all changes necessary to sys.path.

For ease-of-use during development of packages, a dependency may also have a .sublime-dependency file in the root of the package. This file should contain a two digit loader priority for the dependency. This allows for dependencies to control where, relative to each other, they are added to the sys.path. If a dependency has no other dependencies, it may use a low priority such as 01. For dependencies that need others, a higher number would be appropriate.

## Examples

If the explanation of how dependencies work seems kind of abstract, take a moment and look at the following examples:

*   [bz2][2] - a simple shared library that Package Control uses to obtain better compression of the default channel
*   [cffi][3] - another standard dependency that makes a shared library available to all platforms and architectures
*   [requests][4] - a mirror of the requests module on pypi with pure Python code and a single code base
*   [ssl-linux][5] - a complex example using loader.code to determine what version of OpenSSL a user has installed

## Publishing

Like packages, dependencies are distributed through repositories and cached in channels. See [example-repository.json][6] for the basic documentation on how to add a dependency to the repository JSON.

The dependencies in the default repository are tracked in the file [repository/dependencies.json][7]. To add a new dependency, fork the channel and submit a pull request. Be sure to use the [ChannelRepositoryTools][8] to test your addition.

## Using Dependencies

To mark a package as requiring one or more dependencies, there are two options:

1.  Add a dependencies key to one of the releases - [docs][9]
2.  Add a dependencies.json file to the root of the package - [docs][10]

The dependencies.json approach will likely be more convenient for package developers since they will not be installing their own packages from a channel or repository.

[1]: /docs
[2]: https://github.com/codexns/sublime-bz2
[3]: https://github.com/codexns/sublime-cffi
[4]: https://github.com/packagecontrol/requests
[5]: https://github.com/codexns/sublime-ssl-linux
[6]: https://github.com/wbond/package_control/blob/master/example-repository.json#L384-L440
[7]: https://github.com/wbond/package_control_channel/blob/master/repository/dependencies.json
[8]: https://packagecontrol.io/packages/ChannelRepositoryTools
[9]: https://github.com/wbond/package_control/blob/master/example-repository.json#L248-L258
[10]: https://github.com/wbond/package_control/blob/master/example-dependencies.json
