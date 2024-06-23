foo(string s1, string s2) {
    if ("//" == s1) {
    } else if ("//" == s2) {
        llSay(PUBLIC_CHANNEL, s1);
    }
}

default
{
    state_entry()
    {
        llSay(PUBLIC_CHANNEL, "Hello, Avatar!");
        
    }
}