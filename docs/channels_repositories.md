<!-- https://packagecontrol.io/docs/channels_and_repositories -->
<!-- https://github.com/wbond/packagecontrol.io/blob/master/app/html/docs/channels_and_repositories.html -->

# Channels and Repositories

Channels are JSON files hosted on a URL that contains a list of repository URLs. See [example-channel.json][2] for the format. When a user requests to install a package, their channels are queried for a list of repositories. By default, a single channel is included with Package Control, [https://packagecontrol.io/channel\_v3.json][3]. The only reason to create another channel is if you want to create a private distribution for a closed group of people.

Repositories are JSON files hosted on a URL that contain a list of one or more packages. See [example-repository.json][4] for the format. The JSON structure allows for specifying platforms (windows, osx, linux), compatible versions of Sublime Text, labels, URLs and more. The default channel includes a number of third-party repositories, but also a [single, centralized repository][5] for developers who are using GitHub or BitBucket tag-based releases. This way a package only ever needs to be added to the repository once and almost all further updates to the package can be performed via the GitHub or BitBucket user interfaces.

## Upgrading Repositories to the Newest Schema Version

The package [ChannelRepositoryTools][6] includes a command _Upgrade Repository Schema (Current File)_ that will upgrade the currently open repository JSON to the newest schema\_version.

Once the file has been upgraded, most packages can then be migrated into the [default repository][7]. Most uses of custom repository JSON files were due to deficiencies with schema\_version 1.2 and 2.0.

[1]: /docs
[2]: https://raw.githubusercontent.com/wbond/package_control/master/example-channel.json
[3]: https://packagecontrol.io/channel_v3.json
[4]: https://raw.githubusercontent.com/wbond/package_control/master/example-repository.json
[5]: https://github.com/wbond/package_control_channel/tree/master/repository
[6]: /packages/ChannelRepositoryTools
[7]: https://github.com/wbond/package_control_channel/tree/master/repository
