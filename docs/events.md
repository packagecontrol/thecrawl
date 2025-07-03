<!-- https://packagecontrol.io/docs/events -->
<!-- https://github.com/wbond/packagecontrol.io/blob/master/app/html/docs/events.html -->

# Events

Package Control 3.0 adds an API for package developers to be able to more easily respond to events that affect their packages. The events API is used in concert with the Sublime Text package load/unload handlers.

The following events can be detected:

*   After Install
*   Before Upgrade
*   After Upgrade
*   Before Removal

_**Please note that this API is only available starting with Package Control 3.0.** Users who have not upgraded to 3.0 will not have the package\_control modules available to all packages and errors will occur. In an effort to solve this issue, the old channel files for Package Control 1.x and 2.0 will only contain Package Control itself as of early January 2015. This will ensure that only Package Control 3.0 users will be installing and upgrading packages, making it possible for package developers to use the new events API and [dependencies][2]._

## Sublime Text Load/Unload Handlers

The events API is a layer of extra information that allows code being run inside of the Sublime Text 3 plugin\_loaded() and plugin\_unloaded() handlers. These handlers are automatically executed whenever a package is installed/enabled or removed/disabled, respectively.

Part of what makes these handlers applicable is that Package Control always disables and reenables packages when performing operations on them. This helps ensure that Sublime Text does not parse partially extracted file contents or retain a filesystem lock on files about to be written or removed.

Packages that run on Sublime Text 2 also have slightly different handlers. The example below will include code and comments showing how to support both ST2 and ST3.

## API

The events API is located in the package\_control.events module. It has four functions. Each of these functions returns either a string version number, or None if the package is not in the state specified.

*   events.install("Package Name") - package was just installed
*   events.pre\_upgrade("Package Name") - package is about to be upgraded
*   events.post\_upgrade("Package Name") - package was just upgraded
*   events.remove("Package Name") - package is about to be removed

## Example Code

The following code should be located in one of the .py files in the root of your package.

import sys


package\_name = 'My Package'


def plugin\_loaded():
    from package\_control import events

    if events.install(package\_name):
        print('Installed %s!' % events.install(package\_name))
    elif events.post\_upgrade(package\_name):
        print('Upgraded to %s!' % events.post\_upgrade(package\_name))


def plugin\_unloaded():
    from package\_control import events

    if events.pre\_upgrade(package\_name):
        print('Upgrading from %s!' % events.pre\_upgrade(package\_name))
    elif events.remove(package\_name):
        print('Removing %s!' % events.remove(package\_name))


# Compat with ST2
if sys.version\_info < (3,):
    plugin\_loaded()
    unload\_handler = plugin\_unloaded

[1]: /docs
[2]: /docs/dependencies
