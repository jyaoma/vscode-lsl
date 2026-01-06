#define TEXTURE_PROGRESS "10b15206-6a1b-7170-3368-2bd73fcc5ba6" // Texture for the sliding progress bar, assumes left half is solid and right half is transparent
#define LINK_PROGRESS LINK_THIS // Link number to use to target the progress bar prim, for this example we assume the link number the script is in, you should replace this with a global variable instead of a #define where you search the prim in linkset via name or description to identify it on script startup

// This function draws the progress bar as primitive params list that can be inserted into a llSetLinkPrimitiveParamsFast call. The reason to return a list so that you can batch other primitive params together for performant batched rendering
list progressBar(float progress, float delta, float total)
{
    // Convert down to 0.0-1.0 range
    progress /= total;
    delta /= total;
    
    // Show the subtraction bar
    if(delta < 0.0)
    {
        delta = progress - delta;
    }
    
    // Show addition bar
    else if(delta > 0.0)
    {
        delta = progress;
        progress -= delta;
    }
    
    if(progress < 0.0) progress = 0.0; else if(progress > 1.0) progress = 1.0;
    
    list params = [
        PRIM_LINK_TARGET, LINK_PROGRESS,
        PRIM_TEXTURE, 0, TEXTURE_PROGRESS, <.5, 1, 0>, <.25 - progress * .5, 0, 0>, 0,
        PRIM_TEXTURE, 1, TEXTURE_PROGRESS, <.5, 1, 0>, <.25 - delta * .5, 0, 0>, 0
    ];
    
    return params;
}


default
{
    state_entry()
    {
        llSetTimerEvent(0.1);
    }
    
    timer()
    {
        float progress = 25.0;
        float delta = 0.0;
        float total = 100.0;
        llSetLinkPrimitiveParamsFast(0, progressBar(progress, delta, total));
    }
}