# A live message wall

```
Build a web application called "Wall" where visitors can leave a message that gets instantly published on the wall for others to see.

The wall displays the messages from newest to oldest, and updates lives as new messages are added.

Users do not need to log in. Users do not provide any identification information when adding a message, only the message itself.
Messages cannot be removed.

The website UI is extremely simplistic, resembling a typical text-mode console, it looks like it was a modern TUI like those in claude code and opencode, using a console-like, small font, a dark theme and a text-only, ASCII inspired interface.

There is a top, slim, sticky bar that contains the input for the user to enter its message and the "Add to wall" button. The rest of the screen is devoted to display the wall itself.

Messages on the wall have a fixed size, and the text is cropped if it does not fit into the message card. When clicked, a model opens to let the user read the entire message.

Messages on the wall are displayed from top to bottom and left to right, just like the text flow of newspapers, filling the entire available screen, and scrolling horizontally when there are more messages than the screen can fit.

Add a README.md file that documents the application and its technical structure.
```

## Advanced features

```
Add a couple thousand random messages for testing.
Make the wall lazy loading, so it only loads the first N messages at first, and loads more automatically as the user scrolls to the right.

Prevent users from flooding the wall, for example, by not allowing the same user to add a message if they already added one in the last hour.

Messages in the wall disappear slowly over time, becoming gradually transparent until they completely disappear. The maximum age of all messages is 1 month. Once a message has completely disappeared, you can remove it from the database.
```

## Manual refinements

```
Use cookies + IP instead of only IP for rate limiting.

Change the rate limit to 1 message every 10 minutes.

Show a toast when the user tries to add a message but is rate limited, letting them know about the amount of remaining time until they can post a message again.

When hovering a message, it becomes opaque so hovering old, almost invisible messages allows the user to see them before clicking to reveal the full message.

Links in messages are clickable in the modal.

Add CSRF check to the message posting. Check messages for XSS and other hacks to prevent security bugs.
```